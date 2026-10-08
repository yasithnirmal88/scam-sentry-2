import fs from 'node:fs';
import path from 'node:path';
import { ROOT, pass, fail } from './helpers.mjs';

const rootLevel = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => entry.name);

if (rootLevel.length === 0) {
  pass('no root-level test suites');
} else {
  fail('root-level test suites are not discovered', `move to tests/: ${rootLevel.join(', ')}`);
}

const suites = fs
  .readdirSync(path.join(ROOT, 'tests'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'));

if (suites.length >= 2) {
  pass(`tests/ holds ${suites.length} suites`);
} else {
  fail('tests/ discovery pool', `expected at least 2 suites, found ${suites.length}`);
}
