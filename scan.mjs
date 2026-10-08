#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead, SYSTEM_ROOT } from './lib/paths.mjs';
import { createScanContext } from './providers/_http.mjs';
import { defaultGuard } from './providers/_ip-guard.mjs';
import { installDnsCache, isDnsCacheInstalled } from './providers/_dns-cache.mjs';
import { resolveProvider } from './providers/_registry.mjs';
import { parseFindings, normalizeUrl, REQUIRED_TSV_LABELS } from './lib/tracker.mjs';

const HISTORY_HEADER = ['date', 'url', 'title', 'status', 'source'];
const RUNS_HEADER = ['timestamp', 'source', 'entries', 'postings', 'added', 'skipped'];
const ADDITION_HEADER = [...REQUIRED_TSV_LABELS, 'company', 'location', 'notes'];

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function has(argv, name) {
  return argv.includes(name);
}

export function resolvePortalsFile(env = process.env, opts = {}) {
  const dataRoot = opts.dataRoot ?? resolveDataRoot(env, opts);
  const explicit = env.SCAM_SENTRY_PORTALS || opts.portals;
  if (explicit) return path.resolve(dataRoot, explicit);
  const user = path.join(dataRoot, 'portals.yml');
  if (fs.existsSync(user)) return user;
  return path.join(SYSTEM_ROOT, 'config', 'portals.example.yml');
}

function loadPortals(file) {
  if (!fs.existsSync(file)) throw new Error(`portals file not found: ${file}`);
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object') throw new Error(`${file} is empty`);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  return { file, entries };
}

function collectNumbers(dataRoot, env) {
  const used = new Set();
  const trackerPath = resolveTrackerRead(env);
  if (fs.existsSync(trackerPath)) {
    for (const row of parseFindings(fs.readFileSync(trackerPath, 'utf8')).rows) {
      if (!row.malformed && /^\d+$/.test(row.num)) used.add(Number(row.num));
    }
  }
  const reportsDir = path.join(dataRoot, 'reports');
  if (fs.existsSync(reportsDir)) {
    for (const name of fs.readdirSync(reportsDir)) {
      const match = name.match(/^(\d+)[-.]/);
      if (match) used.add(Number(match[1]));
    }
  }
  const additionsDir = path.join(dataRoot, 'data', 'additions');
  if (fs.existsSync(additionsDir)) {
    for (const name of fs.readdirSync(additionsDir)) {
      const match = name.match(/^(\d+)[^/]*\.tsv$/);
      if (match) used.add(Number(match[1]));
    }
  }
  return used;
}

function loadHistory(dataRoot) {
  const file = path.join(dataRoot, 'data', 'scan-history.tsv');
  if (!fs.existsSync(file)) return { file, urls: new Set(), rows: [] };
  const rows = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(1);
  const urls = new Set();
  for (const line of rows) {
    const cells = line.split('\t');
    if (cells.length >= 2) urls.add(normalizeUrl(cells[1]));
  }
  return { file, urls, rows };
}

function cleanCell(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function entryFilters(entry) {
  const filters = entry?.filters ?? {};
  const list = (key) =>
    Array.isArray(filters[key]) ? filters[key].map((item) => String(item).toLowerCase()) : [];
  return { titleBlacklist: list('title_blacklist'), locationBlacklist: list('location_blacklist') };
}

function filterStatus(posting, filters) {
  const title = cleanCell(posting.title).toLowerCase();
  const location = cleanCell(posting.location).toLowerCase();
  for (const term of filters.titleBlacklist) if (title.includes(term)) return 'skipped_title';
  for (const term of filters.locationBlacklist) if (location.includes(term)) return 'skipped_location';
  return 'added';
}

export async function runScan(opts = {}) {
  const env = opts.env ?? process.env;
  const dryRun = opts.dryRun === true;
  const dataRoot = resolveDataRoot(env, opts);
  const portalsFile = resolvePortalsFile(env, opts);
  const { entries } = loadPortals(portalsFile);
  const providersDir = env.SCAM_SENTRY_PROVIDERS_DIR || opts.providersDir;
  const limit = opts.limit ?? 0;

  if (String(env.SCAM_SENTRY_DNS_CACHE ?? '1') !== '0' && !isDnsCacheInstalled()) {
    installDnsCache({ ttlMs: 60_000 });
  }

  const ctx = createScanContext({ guard: defaultGuard(), maxPages: opts.maxPages ?? 1 });
  const history = loadHistory(dataRoot);
  const seen = new Set(history.urls);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const today = new Date().toISOString().slice(0, 10);

  const results = [];
  const postings = [];
  let postingsCount = 0;

  for (const entry of entries) {
    if (entry?.enabled === false) continue;
    const name = String(entry?.name ?? entry?.integration ?? entry?.url ?? 'anonymous');
    const resolved = await resolveProvider(entry, { dir: providersDir });
    if (!resolved) {
      results.push({ entry: name, status: 'no_provider' });
      continue;
    }
    const spec = resolved.spec;
    try {
      if (typeof spec.assertEntryAllowed === 'function') spec.assertEntryAllowed(entry);
    } catch (error) {
      results.push({ entry: name, status: 'error', error: error.message });
      continue;
    }
    let fetched = [];
    try {
      const out = await spec.fetch(entry, ctx);
      if (Array.isArray(out)) fetched = out;
    } catch (error) {
      results.push({ entry: name, status: 'error', error: error.message });
      continue;
    }
    const filters = entryFilters(entry);
    for (const posting of fetched) {
      postingsCount += 1;
      const title = cleanCell(posting.title);
      const url = cleanCell(posting.url);
      if (!title || !url) {
        results.push({ entry: name, status: 'invalid_posting', title });
        continue;
      }
      const normalized = normalizeUrl(url);
      if (seen.has(normalized)) {
        results.push({ entry: name, status: 'duplicate', title, url: normalized });
        continue;
      }
      seen.add(normalized);
      const status = filterStatus(posting, filters);
      if (status !== 'added') {
        results.push({ entry: name, status, title, url: normalized });
        continue;
      }
      postings.push({ ...posting, url: normalized, source: cleanCell(entry.source || spec.id) });
      results.push({ entry: name, status: 'added', title, url: normalized });
      if (limit > 0 && postings.length >= limit) break;
    }
    if (limit > 0 && postings.length >= limit) break;
  }

  const counts = {
    postings: postingsCount,
    added: 0,
    duplicate: 0,
    skipped_title: 0,
    skipped_location: 0,
    no_provider: 0,
    invalid_posting: 0,
    error: 0,
  };
  for (const result of results) {
    if (typeof counts[result.status] === 'number') counts[result.status] += 1;
  }

  const used = collectNumbers(dataRoot, env);
  let nextNum = 1;
  for (const num of used) nextNum = Math.max(nextNum, num + 1);

  if (!dryRun) {
    const additionsDir = path.join(dataRoot, 'data', 'additions');
    fs.mkdirSync(additionsDir, { recursive: true });
    postings.forEach((posting, index) => {
      const num = String(nextNum + index);
      const padded = String(nextNum + index).padStart(3, '0');
      const file = path.join(additionsDir, `${padded}-scan-${runId}.tsv`);
      const cells = [
        num,
        today,
        cleanCell(posting.title),
        cleanCell(posting.source),
        cleanCell(posting.company),
        posting.url,
        '—',
        '—',
        'Queued',
        '—',
        cleanCell(posting.company),
        cleanCell(posting.location),
        '',
      ];
      fs.writeFileSync(file, `${ADDITION_HEADER.join('\t')}\n${cells.join('\t')}\n`, 'utf8');
    });

    const historyFile = path.join(dataRoot, 'data', 'scan-history.tsv');
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    const historyLines = [HISTORY_HEADER.join('\t'), ...history.rows];
    for (const posting of postings) {
      historyLines.push([today, posting.url, cleanCell(posting.title), 'added', cleanCell(posting.source)].join('\t'));
    }
    for (const result of results) {
      if (!['duplicate', 'skipped_title', 'skipped_location'].includes(result.status) || !result.url) continue;
      historyLines.push([today, result.url, cleanCell(result.title), result.status, cleanCell(result.entry)].join('\t'));
    }
    fs.writeFileSync(historyFile, `${historyLines.join('\n')}\n`, 'utf8');

    const runsFile = path.join(dataRoot, 'data', 'scan-runs.tsv');
    fs.mkdirSync(path.dirname(runsFile), { recursive: true });
    const runsHeader = fs.existsSync(runsFile) ? '' : `${RUNS_HEADER.join('\t')}\n`;
    const skipped = counts.duplicate + counts.skipped_title + counts.skipped_location;
    fs.appendFileSync(
      runsFile,
      `${runsHeader}${[new Date().toISOString(), path.basename(portalsFile), entries.length, postingsCount, postings.length, skipped].join('\t')}\n`,
      'utf8',
    );
  }

  return {
    ok: counts.error === 0,
    dryRun,
    portals: portalsFile,
    runId,
    counts,
    results,
    nextNum,
  };
}

export async function main(argv) {
  const asJson = has(argv, '--json');
  const dryRun = has(argv, '--dry-run');
  const limit = Number(flag(argv, '--limit') ?? '0');
  const maxPages = Number(flag(argv, '--max-pages') ?? '1');
  const portals = flag(argv, '--portals');
  const providersDir = flag(argv, '--providers-dir');

  try {
    const report = await runScan({ dryRun, limit, maxPages, portals, providersDir });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    console.log(
      `scan ${report.ok ? 'ok' : 'with-errors'} · ${report.counts.postings} postings · ${report.counts.added} added · ` +
        `${report.counts.duplicate} dup · ${report.counts.skipped_title} title-filters · ${report.counts.skipped_location} location-filters · ` +
        `${report.counts.no_provider} no-provider · ${report.counts.error} errors`,
    );
    for (const result of report.results) {
      if (result.status === 'added') continue;
      console.log(`  ${result.status}: ${result.entry}${result.error ? ` — ${result.error}` : result.title ? ` — ${result.title}` : ''}`);
    }
    return report.ok ? 0 : 1;
  } catch (error) {
    if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    else console.error(error.message);
    return 1;
  }
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code));