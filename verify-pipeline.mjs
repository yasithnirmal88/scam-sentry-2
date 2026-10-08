#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { loadStates, resolveState, isSentinel, resolveEnum } from './lib/states.mjs';
import { walkFiles } from './lib/files.mjs';
import {
  parseFindings,
  parseAddition,
  validateRow,
  dedupKey,
  reportTarget,
  STATUS_LOG_HEADER,
  VALID_SOURCES,
} from './lib/tracker.mjs';

const RESERVATIONS = 'report-nums.reserved.tsv';
const RESERVATION_HEADER = ['start', 'end', 'timestamp'];
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const BOLD_RE = /\*\*[^*]+\*\*/;

function readReservations(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const rows = [];
  for (const line of lines.slice(1)) {
    const [start, end, timestamp] = line.split('\t');
    if (!start || !end) continue;
    rows.push({ start: Number(start), end: Number(end), timestamp: timestamp ?? '' });
  }
  return rows;
}

function listTopLevel(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(ext) && fs.statSync(path.join(dir, name)).isFile())
    .sort()
    .map((name) => path.join(dir, name));
}

export function runChecks(opts = {}) {
  const env = opts.env ?? process.env;
  const fix = opts.fix === true;
  const dataRoot = resolveDataRoot(env);
  const checks = [];
  const add = (id, name, level, messages) => checks.push({ id, name, level, messages });

  let catalog;
  try {
    catalog = loadStates();
  } catch (error) {
    add(0, 'states configuration', 'error', [error.message]);
    return checks;
  }

  const trackerPath = resolveTrackerRead(env);
  const trackerDir = path.dirname(trackerPath);
  const trackerExists = fs.existsSync(trackerPath);
  const parsed = trackerExists ? parseFindings(fs.readFileSync(trackerPath, 'utf8')) : { rows: [] };
  const rows = parsed.rows;
  const wellFormed = rows.filter((row) => !row.malformed);
  const reportsDir = path.join(dataRoot, 'reports');
  const reportFiles = fs.existsSync(reportsDir) ? walkFiles(reportsDir, { ext: '.md' }) : [];
  const additionFiles = listTopLevel(path.join(dataRoot, 'data', 'additions'), '.tsv');
  const logPath = path.join(dataRoot, 'data', 'status-log.tsv');
  const skipTracker = (message) => (trackerExists ? null : message);

  // 1 - canonical statuses
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      for (const row of wellFormed) {
        const resolved = resolveState(catalog, row.status);
        if (!resolved) messages.push(`row ${row.num}: unknown status "${row.status}"`);
        else if (resolved !== row.status) {
          messages.push(`row ${row.num}: non-canonical status "${row.status}" (canonical: ${resolved})`);
        }
      }
    }
    add(1, 'canonical statuses', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 2 - duplicate identities
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      const seen = new Map();
      for (const row of wellFormed) {
        const key = dedupKey(row);
        if (seen.has(key)) messages.push(`row ${row.num} duplicates row ${seen.get(key)} (${key})`);
        else seen.set(key, row.num);
      }
    }
    add(2, 'duplicate identities', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 3 - report links resolve
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      for (const row of wellFormed) {
        const status = resolveState(catalog, row.status);
        const target = reportTarget(row.report);
        if (!target) {
          if (status && catalog.requiresReport.has(status)) {
            messages.push(`row ${row.num}: status ${status} requires a report link, found "${row.report}"`);
          }
          continue;
        }
        const absolute = path.resolve(trackerDir, target);
        if (!fs.existsSync(absolute)) messages.push(`row ${row.num}: report file missing: ${target}`);
      }
    }
    add(3, 'report links resolve', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 4 - risk and confidence format
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      for (const row of wellFormed) {
        if (!isSentinel(catalog, row.risk) && !resolveEnum(catalog.riskLevels, row.risk)) {
          messages.push(`row ${row.num}: invalid risk cell "${row.risk}"`);
        }
        if (!isSentinel(catalog, row.confidence) && !resolveEnum(catalog.confidenceLevels, row.confidence)) {
          messages.push(`row ${row.num}: invalid confidence cell "${row.confidence}"`);
        }
      }
    }
    add(4, 'risk and confidence format', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 5 - row format
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      for (const row of rows) {
        if (row.malformed) {
          messages.push(`malformed row (${row.cells?.length ?? 0} cells): ${(row.raw ?? '').slice(0, 60)}`);
          continue;
        }
        for (const message of validateRow(row, catalog)) messages.push(`row ${row.num}: ${message}`);
      }
    }
    add(5, 'row format', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 6 - pending additions
  {
    const messages = [];
    for (const file of additionFiles) {
      const parsedAddition = parseAddition(fs.readFileSync(file, 'utf8'));
      const fileErrors = [...parsedAddition.errors];
      if (parsedAddition.row) fileErrors.push(...validateRow(parsedAddition.row, catalog));
      for (const message of fileErrors) messages.push(`${path.basename(file)}: ${message}`);
    }
    add(6, 'pending additions', messages.length ? 'error' : 'ok', messages);
  }

  // 7 - bold markup in cells
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      for (const row of wellFormed) {
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith('_') || typeof value !== 'string') continue;
          if (BOLD_RE.test(value)) messages.push(`row ${row.num}: bold markup in ${key} cell`);
        }
      }
    }
    add(7, 'bold markup in cells', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 8 - stale report-number reservations
  {
    const reservationsPath = path.join(dataRoot, 'data', RESERVATIONS);
    const reservations = readReservations(reservationsPath);
    const stale = reservations.filter((row) => Date.now() - Date.parse(row.timestamp || 0) > STALE_MS);
    if (stale.length) {
      const labels = stale.map((row) => `${row.start}-${row.end}`);
      if (fix) {
        const keep = reservations.filter((row) => !stale.includes(row));
        const lines = keep.map((row) => [row.start, row.end, row.timestamp].join('\t'));
        fs.mkdirSync(path.dirname(reservationsPath), { recursive: true });
        fs.writeFileSync(reservationsPath, `${[RESERVATION_HEADER.join('\t'), ...lines].join('\n')}\n`, 'utf8');
        add(8, 'stale report-number reservations', 'ok', [
          `garbage-collected ${stale.length} stale reservation(s): ${labels.join(', ')}`,
        ]);
      } else {
        add(8, 'stale report-number reservations', 'warn', [
          `stale reservation(s) older than 7 days: ${labels.join(', ')} (re-run with --fix to collect)`,
        ]);
      }
    } else {
      add(8, 'stale report-number reservations', 'ok', []);
    }
  }

  // 9 - duplicate report numbers
  {
    const messages = [];
    const byNum = new Map();
    for (const file of reportFiles) {
      const base = path.basename(file);
      const match = base.match(/^(\d+)[-.]/);
      if (!match) continue;
      const key = Number(match[1]);
      if (!byNum.has(key)) byNum.set(key, []);
      byNum.get(key).push(base);
    }
    for (const [num, files] of byNum) {
      if (files.length > 1) messages.push(`report number ${num} used by: ${files.join(', ')}`);
    }
    add(9, 'duplicate report numbers', messages.length ? 'error' : 'ok', messages);
  }

  // 10 - orphan reports
  {
    const messages = [];
    const referenced = new Set();
    for (const row of wellFormed) {
      const target = reportTarget(row.report);
      if (!target) continue;
      referenced.add(path.resolve(trackerDir, target));
    }
    for (const file of reportFiles) {
      if (!referenced.has(path.resolve(file))) messages.push(`not referenced by any row: ${path.basename(file)}`);
    }
    add(10, 'orphan reports', messages.length ? 'warn' : 'ok', messages);
  }

  // 11 - source consistency
  {
    const errors = [];
    const warnings = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) {
      add(11, 'source consistency', 'ok', [missing]);
    } else {
      for (const row of wellFormed) {
        if (!row.source) errors.push(`row ${row.num}: empty source cell`);
        const target = reportTarget(row.report);
        if (!target) continue;
        const absolute = path.resolve(trackerDir, target);
        if (!fs.existsSync(absolute)) continue;
        const text = fs.readFileSync(absolute, 'utf8');
        const declared = text.match(/\*\*Source:\*\*\s*(\S+)/);
        if (declared && declared[1] !== row.source) {
          warnings.push(`row ${row.num}: tracker source "${row.source}" does not match report source "${declared[1]}"`);
        }
      }
      if (errors.length) add(11, 'source consistency', 'error', errors.concat(warnings));
      else add(11, 'source consistency', warnings.length ? 'warn' : 'ok', warnings);
    }
  }

  // 12 - duplicate tracker numbers
  {
    const messages = [];
    const missing = skipTracker('tracker not initialized');
    if (missing) messages.push(missing);
    else {
      const seen = new Set();
      for (const row of wellFormed) {
        if (seen.has(row.num)) messages.push(`number ${row.num} appears more than once`);
        else seen.add(row.num);
      }
    }
    add(12, 'duplicate tracker numbers', missing ? 'ok' : messages.length ? 'error' : 'ok', messages);
  }

  // 13 - status log sync
  {
    if (!fs.existsSync(logPath)) {
      add(13, 'status log sync', 'ok', []);
    } else {
      const errors = [];
      const warnings = [];
      const lines = fs
        .readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
      const latest = new Map();
      for (const line of lines.slice(1)) {
        const cells = line.split('\t');
        if (cells.length < 6) continue;
        latest.set(cells[4], cells[2]);
      }
      const rowNums = new Set(wellFormed.map((row) => row.num));
      for (const row of wellFormed) {
        if (!latest.has(row.num)) continue;
        const logged = latest.get(row.num);
        if (logged !== row.status) {
          errors.push(`row ${row.num}: tracker says "${row.status}" but the last log entry says "${logged}"`);
        }
      }
      for (const num of latest.keys()) {
        if (!rowNums.has(num)) warnings.push(`log entries reference row ${num}, which is not in the tracker`);
      }
      if (errors.length) add(13, 'status log sync', 'error', errors.concat(warnings));
      else add(13, 'status log sync', warnings.length ? 'warn' : 'ok', warnings);
    }
  }

  // 14 - status log schema
  {
    if (!fs.existsSync(logPath)) {
      add(14, 'status log schema', 'ok', []);
    } else {
      const messages = [];
      const lines = fs
        .readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
      const header = (lines[0] ?? '').split('\t');
      if (header.join(',') !== STATUS_LOG_HEADER.join(',')) {
        messages.push(`header must be: ${STATUS_LOG_HEADER.join(' | ')}`);
      }
      lines.slice(1).forEach((line, index) => {
        const cells = line.split('\t');
        if (cells.length !== STATUS_LOG_HEADER.length) {
          messages.push(`line ${index + 2}: expected ${STATUS_LOG_HEADER.length} cells, found ${cells.length}`);
          return;
        }
        const [timestamp, prev, next, source, num] = cells;
        if (Number.isNaN(Date.parse(timestamp))) messages.push(`line ${index + 2}: invalid timestamp "${timestamp}"`);
        if (prev !== '-' && !resolveState(catalog, prev)) messages.push(`line ${index + 2}: invalid prev "${prev}"`);
        if (!resolveState(catalog, next)) messages.push(`line ${index + 2}: invalid new "${next}"`);
        if (!VALID_SOURCES.includes(source)) messages.push(`line ${index + 2}: invalid source "${source}"`);
        if (!/^\d+$/.test(num)) messages.push(`line ${index + 2}: invalid num "${num}"`);
      });
      add(14, 'status log schema', messages.length ? 'error' : 'ok', messages);
    }
  }

  return checks;
}

function pad(name) {
  return `${name} ${'.'.repeat(Math.max(3, 36 - name.length))}`;
}

function main(argv) {
  const asJson = argv.includes('--json');
  const summaryOnly = argv.includes('--summary');
  const fix = argv.includes('--fix');
  const checks = runChecks({ fix });
  const errors = checks.filter((check) => check.level === 'error');
  const warnings = checks.filter((check) => check.level === 'warn');

  if (asJson) {
    console.log(
      JSON.stringify({ ok: errors.length === 0, errors: errors.length, warnings: warnings.length, checks }, null, 2),
    );
  } else if (summaryOnly) {
    const okCount = checks.filter((check) => check.level === 'ok').length;
    console.log(`checks=${checks.length} ok=${okCount} warn=${warnings.length} error=${errors.length}`);
  } else {
    console.log(`verify-pipeline: ${checks.length} checks`);
    for (const check of checks) {
      const label = check.level === 'ok' ? 'ok  ' : check.level === 'warn' ? 'warn' : 'FAIL';
      console.log(` ${String(check.id).padStart(2)}. ${pad(check.name)} ${label}`);
      if (check.level !== 'ok') for (const message of check.messages) console.log(`      ${message}`);
    }
    console.log(`summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  return errors.length ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
