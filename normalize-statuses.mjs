#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { loadStates, resolveState } from './lib/states.mjs';
import {
  parseFindings,
  renderFindings,
  canonicalizeRow,
  atomicWrite,
  withLock,
  TrackerError,
  STATUS_LOG_HEADER,
} from './lib/tracker.mjs';

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  const states = loadStates();
  const trackerPath = resolveTrackerRead(env);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');
  const logPath = path.join(dataRoot, 'data', 'status-log.tsv');

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else if (payload.invalid?.length) for (const item of payload.invalid) console.error(item);
    else console.log(payload.message ?? '');
    return code;
  };

  if (!fs.existsSync(trackerPath)) return respond({ ok: false, invalid: [`tracker not initialized: ${trackerPath}`] }, 5);

  try {
    return withLock(lockPath, () => {
      const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
      const normalized = [];
      const invalid = [];
      const changes = [];
      for (const row of parsed.rows) {
        if (row.malformed) {
          changes.push(`row ${row.cells?.[0] ?? '?'}: malformed row left untouched`);
          continue;
        }
        const before = row.status;
        if (!resolveState(states, before)) {
          invalid.push(`row ${row.num}: unknown status "${before}"`);
          continue;
        }
        const after = resolveState(states, before);
        const canonicalized = canonicalizeRow(row, states);
        if (after !== before) {
          changes.push(`row ${row.num}: ${before} → ${after}`);
          normalized.push({ num: row.num, prev: before, next: after });
        }
        Object.assign(row, canonicalized);
        row.status = after;
      }

      if (!dryRun && changes.length) {
        atomicWrite(trackerPath, renderFindings(parsed.rows));
        const header = fs.existsSync(logPath) ? '' : `${STATUS_LOG_HEADER.join('\t')}\n`;
        const stamp = new Date().toISOString();
        const lines = normalized.map((entry) =>
          [stamp, entry.prev, entry.next, 'script', entry.num, 'normalize-statuses'].join('\t'),
        );
        if (lines.length) fs.appendFileSync(logPath, `${header}${lines.join('\n')}\n`);
      }

      return respond(
        {
          ok: invalid.length === 0,
          changed: changes.length,
          changes,
          invalid,
          dryRun,
          message: `${dryRun ? 'would normalize' : 'normalized'} ${changes.length} status cell(s)`,
        },
        invalid.length ? 1 : 0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, invalid: [error.message] }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
