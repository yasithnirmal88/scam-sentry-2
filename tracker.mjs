#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead, resolveTrackerWrite } from './lib/paths.mjs';
import { loadStates, resolveState } from './lib/states.mjs';
import { parseFindings, renderFindings, atomicWrite, COLUMN_KEYS, SENTINEL_DISPLAY } from './lib/tracker.mjs';

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function has(argv, name) {
  return argv.includes(name);
}

function main(argv) {
  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  const states = loadStates();
  const readPath = resolveTrackerRead(env);
  const writePath = resolveTrackerWrite(env);

  if (has(argv, '--init')) {
    if (fs.existsSync(writePath)) {
      console.log(`tracker already exists: ${writePath}`);
      return 0;
    }
    atomicWrite(writePath, renderFindings([]));
    console.log(`created ${writePath}`);
    return 0;
  }

  if (!fs.existsSync(readPath)) {
    if (has(argv, '--json')) console.log(JSON.stringify({ initialized: false, rows: [] }, null, 2));
    else console.log('tracker not initialized — run: node tracker.mjs --init');
    return 0;
  }

  const parsed = parseFindings(fs.readFileSync(readPath, 'utf8'));
  let rows = parsed.rows.filter((row) => !row.malformed);

  const statusFilter = flag(argv, '--status');
  if (statusFilter) {
    const canonical = resolveState(states, statusFilter);
    rows = rows.filter((row) => (canonical ? row.status === canonical : row.status === statusFilter));
  }
  const riskFilter = flag(argv, '--risk');
  if (riskFilter) {
    rows = rows.filter((row) => row.risk.toLowerCase() === riskFilter.toLowerCase());
  }
  const findFilter = flag(argv, '--find');
  if (findFilter) {
    const needle = findFilter.toLowerCase();
    rows = rows.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        String(row.company).toLowerCase().includes(needle) ||
        String(row.notes).toLowerCase().includes(needle),
    );
  }
  const limit = Number(flag(argv, '--limit') ?? '0');
  if (limit > 0) rows = rows.slice(0, limit);

  if (has(argv, '--json')) {
    const clean = rows.map((row) => {
      const out = {};
      for (const key of COLUMN_KEYS) out[key] = row[key] ?? '';
      return out;
    });
    console.log(JSON.stringify({ initialized: true, tracker: readPath, rows: clean }, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    console.log('no rows');
    return 0;
  }
  for (const row of rows) {
    const company = row.company || '—';
    const report = row.report || SENTINEL_DISPLAY;
    console.log(
      `${String(row.num).padStart(4)}  ${row.date}  ${String(row.risk).padEnd(8)}  ${String(row.confidence).padEnd(5)}  ${String(row.status).padEnd(10)}  ${row.title}  [${company}]  report=${report}`,
    );
  }
  console.log(`${rows.length} row(s) · ${path.relative(dataRoot, readPath) || readPath}`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
