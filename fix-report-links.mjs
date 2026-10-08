#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { loadStates } from './lib/states.mjs';
import { parseFindings, renderFindings, rewriteReportLink, atomicWrite, withLock, TrackerError } from './lib/tracker.mjs';

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  loadStates();
  const trackerPath = resolveTrackerRead(env);
  const trackerDir = path.dirname(trackerPath);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else console.log(payload.message ?? '');
    if (payload.warnings?.length && !asJson) for (const warning of payload.warnings) console.error(`warn: ${warning}`);
    return code;
  };

  if (!fs.existsSync(trackerPath)) return respond({ ok: false, message: `tracker not initialized: ${trackerPath}` }, 5);

  try {
    return withLock(lockPath, () => {
      const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
      const changed = [];
      const warnings = [];
      for (const row of parsed.rows) {
        if (row.malformed) continue;
        const before = row.report;
        const after = rewriteReportLink(before, { root: dataRoot, trackerDir });
        if (after !== before) {
          changed.push({ num: row.num, before, after });
          row.report = after;
        }
        const target = after.match(/^\[[^\]]*\]\((.+)\)$/) ?? [null, after];
        if (after !== '—' && target[1] && !fs.existsSync(path.resolve(trackerDir, target[1]))) {
          warnings.push(`row ${row.num}: report target missing: ${target[1]}`);
        }
      }
      if (!dryRun && changed.length) atomicWrite(trackerPath, renderFindings(parsed.rows));
      return respond(
        {
          ok: true,
          changed: changed.length,
          changes: changed,
          warnings,
          dryRun,
          message: `${dryRun ? 'would rewrite' : 'rewrote'} ${changed.length} report link(s)`,
        },
        0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, message: error.message }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
