import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, NODE, run, walkFiles, codeMask, stripJsComments, isCodeRange, rmSync, pass, fail, warn } from './helpers.mjs';

const found = walkFiles(path.join(ROOT, 'tests'), { ext: '.test.mjs' });
if (found.some((file) => file.endsWith(`${path.sep}helpers.test.mjs`))) {
  pass('walkFiles finds nested suites');
} else {
  fail('walkFiles finds nested suites');
}

const skipped = walkFiles(ROOT, { ext: '.mjs' });
if (skipped.some((file) => file.includes('node_modules'))) {
  fail('walkFiles skips node_modules');
} else {
  pass('walkFiles skips node_modules');
}

try {
  run('definitely-not-an-allowed-executable', []);
  fail('run() rejects non-allowlisted executables');
} catch {
  pass('run() rejects non-allowlisted executables');
}

const exitResult = run(NODE, ['-e', 'process.exit(7)']);
if (exitResult.code === 7) {
  pass('run() reports exit codes');
} else {
  fail('run() reports exit codes', `got ${exitResult.code}`);
}

const code = "const a = 'fetch(x)'; // fetch(y)\n/* fetch(z) */ fetch(w);";
const mask = codeMask(code);
if (mask.length === code.length) {
  pass('codeMask preserves length');
} else {
  fail('codeMask preserves length', `${mask.length} vs ${code.length}`);
}

const rangeIsCode = (snippet) => {
  const start = code.indexOf(snippet);
  return isCodeRange(mask, start, start + snippet.length);
};

for (const [snippet, expected] of [
  ['fetch(x)', false],
  ['fetch(y)', false],
  ['fetch(z)', false],
  ['fetch(w)', true],
]) {
  if (rangeIsCode(snippet) === expected) pass(`codeMask classifies ${snippet}`);
  else fail(`codeMask classifies ${snippet}`, `expected code=${expected}`);
}

const stripped = stripJsComments(code);
if (stripped.includes("'fetch(x)'") && !stripped.includes('fetch(y)') && !stripped.includes('fetch(z)')) {
  pass('stripJsComments keeps strings, drops comments');
} else {
  fail('stripJsComments keeps strings, drops comments', stripped);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-helpers-'));
fs.writeFileSync(path.join(temp, 'a.txt'), 'x');
rmSync(temp);
if (!fs.existsSync(temp)) pass('rmSync removes a temp tree');
else fail('rmSync removes a temp tree');

warn('intentional warning so warn counters are exercised');
