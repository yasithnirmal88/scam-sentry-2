#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead, SYSTEM_ROOT } from './lib/paths.mjs';
import { loadStates } from './lib/states.mjs';
import {
  parseFindings,
  renderFindings,
  parseAddition,
  validateRow,
  canonicalizeRow,
  dedupKey,
  rewriteReportLink,
  atomicWrite,
  withLock,
  TrackerError,
} from './lib/tracker.mjs';

function listAdditions(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.tsv') && fs.statSync(path.join(dir, name)).isFile())
    .sort()
    .map((name) => path.join(dir, name));
}

function backfillUrl(row, dataRoot) {
  const target = row.report;
  if (!target || target === '—') return null;
  const rel = target.replace(/^\[[^\]]*\]\((.+)\)$/, '$1');
  const candidates = [path.resolve(dataRoot, rel), path.resolve(dataRoot, 'reports', path.basename(rel))];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const starred = text.match(/\*\*URL:\*\*\s*(\S+)/);
    if (starred && /^https?:\/\//i.test(starred[1])) return starred[1];
    const yamlUrl = text.match(/^url:\s*["']?(https?:\/\/[^\s"']+)/m);
    if (yamlUrl) return yamlUrl[1];
  }
  return null;
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const migrate = argv.includes('--migrate');
  const backfill = argv.includes('--backfill-urls');

  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  const states = loadStates();
  const trackerPath = resolveTrackerRead(env);
  const trackerDir = path.dirname(trackerPath);
  const additionsDir = path.join(dataRoot, 'data', 'additions');
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else if (payload.errors?.length) for (const error of payload.errors) console.error(error);
    else console.log(payload.message ?? '');
    return code;
  };

  try {
    return withLock(lockPath, () => {
      const errors = [];
      let rows = [];
      if (fs.existsSync(trackerPath)) {
        const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
        const malformed = parsed.rows.filter((row) => row.malformed);
        if (malformed.length) {
          errors.push(`tracker has ${malformed.length} malformed row(s) — repair before merging`);
          return respond({ ok: false, errors, merged: 0, skipped: 0 }, 1);
        }
        rows = parsed.rows.map((row) => canonicalizeRow(row, states));
      }

      const additionFiles = listAdditions(additionsDir);
      const accepted = [];
      const skipped = [];
      const seen = new Map(rows.map((row) => [dedupKey(row), row.num]));

      for (const file of additionFiles) {
        const parsedAddition = parseAddition(fs.readFileSync(file, 'utf8'));
        const fileErrors = [...parsedAddition.errors];
        let row = parsedAddition.row;
        if (row) {
          const validation = validateRow(row, states);
          fileErrors.push(...validation);
        }
        if (fileErrors.length) {
          errors.push(`${path.basename(file)}:\n  ${fileErrors.join('\n  ')}`);
          continue;
        }
        row = canonicalizeRow(row, states);
        const key = dedupKey(row);
        if (seen.has(key)) {
          skipped.push({ file: path.basename(file), num: row.num, duplicateOf: seen.get(key) });
          continue;
        }
        seen.set(key, row.num);
        row.report = rewriteReportLink(row.report, { root: dataRoot, trackerDir });
        accepted.push({ file, row });
      }

      if (errors.length) return respond({ ok: false, errors, merged: 0, skipped }, 1);

      if (migrate) {
        for (const row of rows) {
          row.report = rewriteReportLink(row.report, { root: dataRoot, trackerDir });
        }
      }
      if (backfill) {
        for (const row of rows) {
          if (row.url !== '—') continue;
          const filled = backfillUrl(row, dataRoot);
          if (filled) row.url = filled;
        }
        for (const { row } of accepted) {
          if (row.url !== '—') continue;
          const filled = backfillUrl(row, dataRoot);
          if (filled) row.url = filled;
        }
      }

      rows.push(...accepted.map(({ row }) => row));
      rows.sort((a, b) => Number(a.num) - Number(b.num));

      const consumed = accepted.map(({ file }) => file);
      if (!dryRun) {
        if (accepted.length || migrate || backfill) {
          atomicWrite(trackerPath, renderFindings(rows));
        }
        const mergedDir = path.join(additionsDir, 'merged');
        for (const file of consumed) {
          const target = path.join(mergedDir, path.basename(file));
          fs.mkdirSync(mergedDir, { recursive: true });
          if (fs.existsSync(target)) fs.unlinkSync(target);
          fs.renameSync(file, target);
        }
      }

      return respond(
        {
          ok: true,
          merged: accepted.length,
          skipped,
          consumed: consumed.map((file) => path.basename(file)),
          dryRun,
          message: `${dryRun ? 'would merge' : 'merged'} ${accepted.length} addition(s), skipped ${skipped.length}`,
        },
        0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, errors: [error.message] }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
