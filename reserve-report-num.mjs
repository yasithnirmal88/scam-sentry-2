#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { parseFindings, atomicWrite, withLock, TrackerError, formatNum, parseNumLabel } from './lib/tracker.mjs';

const RESERVATIONS = 'report-nums.reserved.tsv';
const RESERVATION_HEADER = ['start', 'end', 'timestamp'];
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function readReservations(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const [start, end, timestamp] = line.split('\t');
    if (!start || !end) continue;
    rows.push({ start: Number(start), end: Number(end), timestamp: timestamp ?? '' });
  }
  return rows;
}

function writeReservations(file, rows) {
  const lines = rows.map((row) => [row.start, row.end, row.timestamp].join('\t'));
  atomicWrite(file, [RESERVATION_HEADER.join('\t'), ...lines, rows.length ? '' : ''].join('\n'));
}

function usedNumbers(dataRoot, trackerPath) {
  const used = new Set();
  if (fs.existsSync(trackerPath)) {
    const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
    for (const row of parsed.rows) {
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
  return used;
}

function main(argv) {
  const asJson = argv.includes('--json');
  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  const trackerPath = resolveTrackerRead(env);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');
  const reservationsPath = path.join(dataRoot, 'data', RESERVATIONS);

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else if (payload.error) console.error(payload.error);
    else console.log(payload.label ?? payload.message ?? '');
    return code;
  };

  const releaseIndex = argv.indexOf('--release');
  const countIndex = argv.indexOf('--count');
  const releasing = releaseIndex >= 0;
  if (releasing && countIndex >= 0) return respond({ ok: false, error: '--release and --count are mutually exclusive' }, 2);

  try {
    return withLock(lockPath, () => {
      const reservations = readReservations(reservationsPath);

      if (releasing) {
        const label = argv[releaseIndex + 1];
        const range = parseNumLabel(label);
        if (!range) return respond({ ok: false, error: `invalid release label "${label}"` }, 2);
        const index = reservations.findIndex((row) => row.start === range.start && row.end === range.end);
        if (index === -1) return respond({ ok: false, error: `no reservation matches ${label}` }, 2);
        reservations.splice(index, 1);
        writeReservations(reservationsPath, reservations);
        return respond({ ok: true, label, message: `released ${label}` }, 0);
      }

      const count = countIndex >= 0 ? Number(argv[countIndex + 1]) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 1000) {
        return respond({ ok: false, error: '--count must be an integer between 1 and 1000' }, 2);
      }

      const used = usedNumbers(dataRoot, trackerPath);
      let next = 1;
      for (const row of reservations) next = Math.max(next, row.end + 1);
      for (const num of used) next = Math.max(next, num + 1);
      for (const row of reservations) for (let n = row.start; n <= row.end; n += 1) used.add(n);
      const start = next;
      const end = start + count - 1;
      reservations.push({ start, end, timestamp: new Date().toISOString() });
      writeReservations(reservationsPath, reservations);

      const label = count === 1 ? formatNum(start) : `${formatNum(start)}-${formatNum(end)}`;
      const stale = reservations.filter(
        (row) => Date.now() - Date.parse(row.timestamp || 0) > STALE_MS,
      ).length;
      return respond(
        { ok: true, start, end, label, stale, message: `reserved ${label}` },
        0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, error: error.message }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
