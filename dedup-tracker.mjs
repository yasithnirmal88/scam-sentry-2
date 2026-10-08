#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { loadStates } from './lib/states.mjs';
import { parseFindings, renderFindings, dedupKey, atomicWrite, withLock, TrackerError } from './lib/tracker.mjs';

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  loadStates();
  const trackerPath = resolveTrackerRead(env);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else if (payload.error) console.error(payload.error);
    else console.log(payload.message ?? '');
    return code;
  };

  if (!fs.existsSync(trackerPath)) return respond({ ok: false, error: `tracker not initialized: ${trackerPath}` }, 5);

  try {
    return withLock(lockPath, () => {
      const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
      const kept = [];
      const removed = [];
      const seen = new Map();
      for (const row of parsed.rows) {
        if (row.malformed) {
          kept.push(row);
          continue;
        }
        const key = dedupKey(row);
        if (seen.has(key)) {
          removed.push({ num: row.num, duplicateOf: seen.get(key), title: row.title });
          continue;
        }
        seen.set(key, row.num);
        kept.push(row);
      }
      if (!dryRun && removed.length) atomicWrite(trackerPath, renderFindings(kept));
      return respond(
        {
          ok: true,
          removed,
          changed: removed.length,
          dryRun,
          message: `${dryRun ? 'would remove' : 'removed'} ${removed.length} duplicate row(s)`,
        },
        0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, error: error.message }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
