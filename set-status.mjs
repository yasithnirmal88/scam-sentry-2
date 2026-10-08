#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { loadStates, resolveState } from './lib/states.mjs';
import {
  parseFindings,
  renderFindings,
  atomicWrite,
  withLock,
  TrackerError,
  STATUS_LOG_HEADER,
  VALID_SOURCES,
} from './lib/tracker.mjs';

function usage(message) {
  console.error(message);
  console.error('usage: node set-status.mjs <report#|title-substring> <State> [--note "<text>"] [--source <src>] [--dry-run] [--json]');
  return 2;
}

function main(argv) {
  const positionals = argv.filter((arg) => !arg.startsWith('--'));
  if (positionals.length < 2) return usage('a selector and a state are required');
  const [selector, stateArg] = positionals;

  const noteIndex = argv.indexOf('--note');
  const note = noteIndex >= 0 ? argv[noteIndex + 1] ?? '' : '';
  const sourceIndex = argv.indexOf('--source');
  const source = sourceIndex >= 0 ? argv[sourceIndex + 1] ?? 'cli' : 'cli';
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');

  if (!VALID_SOURCES.includes(source)) return usage(`source must be one of ${VALID_SOURCES.join(', ')}`);

  const env = process.env;
  const states = loadStates();
  const canonical = resolveState(states, stateArg);
  if (!canonical) return usage(`unknown state "${stateArg}" — canonical: ${states.names.join(', ')}`);

  const dataRoot = resolveDataRoot(env);
  const trackerPath = resolveTrackerRead(env);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');
  const logPath = path.join(dataRoot, 'data', 'status-log.tsv');

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
      const candidates = parsed.rows.filter((row) => !row.malformed);
      const digits = /^\d+$/.test(selector);
      const matches = digits
        ? candidates.filter((row) => row.num === selector)
        : candidates.filter((row) => row.title.toLowerCase().includes(selector.toLowerCase()));
      if (matches.length === 0) return respond({ ok: false, error: `no row matches "${selector}"` }, 3);
      if (matches.length > 1) {
        const list = matches.map((row) => `${row.num}: ${row.title}`).join('\n  ');
        return respond({ ok: false, error: `ambiguous selector "${selector}":\n  ${list}` }, 3);
      }
      const row = matches[0];
      const prev = row.status;
      if (prev === canonical) {
        return respond({ ok: true, unchanged: true, message: `row ${row.num} is already ${canonical}` }, 0);
      }
      row.status = canonical;
      if (!dryRun) {
        atomicWrite(trackerPath, renderFindings(parsed.rows));
        const header = fs.existsSync(logPath) ? '' : `${STATUS_LOG_HEADER.join('\t')}\n`;
        const stamp = new Date().toISOString();
        const cleanNote = note.replace(/[\t\r\n]+/g, ' ').trim();
        fs.appendFileSync(logPath, `${header}${[stamp, prev, canonical, source, row.num, cleanNote].join('\t')}\n`);
      }
      return respond(
        {
          ok: true,
          num: row.num,
          title: row.title,
          prev,
          next: canonical,
          note,
          dryRun,
          message: `${dryRun ? 'would update' : 'updated'} row ${row.num}: ${prev} → ${canonical}`,
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
