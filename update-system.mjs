#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/entry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');

export function currentVersion(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.version ?? '0.0.0';
}

export function checkForUpdate(root = ROOT) {
  return {
    current: currentVersion(root),
    updateAvailable: false,
    source: null,
    message: 'no update source is configured yet',
  };
}

function respond(json, payload, exitCode) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else console.log(payload.message ?? payload.error ?? '');
  return exitCode;
}

function main(argv) {
  const json = argv.includes('--json');
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'check';
  if (command === 'check') return respond(json, checkForUpdate(), 0);
  if (command === 'apply' || command === 'rollback') {
    return respond(
      json,
      { ok: false, error: `update source is not configured — ${command} is unavailable in this build` },
      1,
    );
  }
  return respond(json, { ok: false, error: `unknown command: ${command}` }, 2);
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
