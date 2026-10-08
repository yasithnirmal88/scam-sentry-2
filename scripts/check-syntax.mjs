#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkFiles, relativePosix } from '../lib/files.mjs';
import { isMainModule } from '../lib/entry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkSyntax(root = ROOT) {
  const files = walkFiles(root, { ext: '.mjs' });
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      failures.push({
        file: relativePosix(root, file),
        message: output.split('\n').find((line) => line.trim()) ?? 'syntax error',
      });
    }
  }
  return { checked: files.length, failures };
}

function main(argv) {
  const json = argv.includes('--json');
  const result = checkSyntax();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.failures.length) {
    for (const failure of result.failures) console.error(`FAIL ${failure.file}: ${failure.message}`);
    console.error(`${result.failures.length} of ${result.checked} files failed the syntax check`);
  } else {
    console.log(`checked ${result.checked} files · 0 failures`);
  }
  return result.failures.length ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
