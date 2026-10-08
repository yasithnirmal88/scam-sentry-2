#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkFiles, relativePosix } from './lib/files.mjs';
import { isMainModule } from './lib/entry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');

export function discoverSuites(root = ROOT) {
  const testsDir = path.join(root, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  return walkFiles(testsDir, { ext: '.test.mjs' });
}

function detectStyle(source) {
  return /from\s+['"]node:test['"]/.test(source) ? 'node:test' : 'passfail';
}

export function runSuite(file, opts = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const style = detectStyle(source);
  const args = style === 'node:test' ? ['--test', '--test-reporter=tap', file] : [file];
  const result = spawnSync(process.execPath, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    env: opts.env ?? process.env,
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let parsed = false;
  if (style === 'passfail') {
    const match = stdout.match(/^SUMMARY pass=(\d+) fail=(\d+) warn=(\d+)/m);
    if (match) {
      pass = Number(match[1]);
      fail = Number(match[2]);
      warn = Number(match[3]);
      parsed = true;
    }
  } else {
    const passMatch = stdout.match(/^# pass (\d+)/m);
    const failMatch = stdout.match(/^# fail (\d+)/m);
    if (passMatch && failMatch) {
      pass = Number(passMatch[1]);
      fail = Number(failMatch[1]);
      parsed = true;
    }
  }
  const code = result.status ?? -1;
  const ok = parsed && code === 0 && fail === 0;
  return { file, style, code, pass, fail, warn, parsed, ok, stdout, stderr };
}

function tail(text, lines = 40) {
  return text.trim().split('\n').slice(-lines).join('\n');
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('usage: node test-all.mjs [--only <substring>]');
    return 0;
  }
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;
  let suites = discoverSuites();
  if (only) suites = suites.filter((file) => relativePosix(ROOT, file).includes(only));
  if (suites.length === 0) {
    console.error(only ? `no suites match --only ${only}` : 'no suites found under tests/');
    return 1;
  }
  console.log(`running ${suites.length} suite${suites.length === 1 ? '' : 's'} from tests/`);
  const totals = { pass: 0, fail: 0, warn: 0 };
  const failed = [];
  for (const file of suites) {
    const rel = relativePosix(ROOT, file);
    const result = runSuite(file);
    totals.pass += result.pass;
    totals.fail += result.fail;
    totals.warn += result.warn;
    const mark = result.ok ? 'PASS' : 'FAIL';
    const warnSuffix = result.warn ? `, ${result.warn} warn` : '';
    console.log(`${mark} ${rel} [${result.style}] ${result.pass} pass, ${result.fail} fail${warnSuffix}`);
    if (!result.ok) {
      failed.push(rel);
      const diagnosis = [result.stdout, result.stderr].filter(Boolean).join('\n');
      if (diagnosis.trim()) console.log(tail(diagnosis));
    }
  }
  console.log(`TOTAL suites=${suites.length} pass=${totals.pass} fail=${totals.fail} warn=${totals.warn}`);
  if (failed.length) {
    console.log(`failed suites: ${failed.join(', ')}`);
    return 1;
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
