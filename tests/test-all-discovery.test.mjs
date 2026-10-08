import path from 'node:path';
import { ROOT, NODE, run, pass, fail, formatRunFailure } from './helpers.mjs';

const filtered = run(NODE, [path.join(ROOT, 'test-all.mjs'), '--only', 'no-root-suites']);
if (filtered.code === 0 && filtered.stdout.includes('no-root-suites')) {
  pass('test-all discovers suites by glob');
} else {
  fail('test-all discovers suites by glob', formatRunFailure(filtered, 'filtered run'));
}

const miss = run(NODE, [path.join(ROOT, 'test-all.mjs'), '--only', 'suite-that-does-not-exist']);
if (miss.code !== 0) {
  pass('an unmatched --only filter fails loudly');
} else {
  fail('an unmatched --only filter fails loudly');
}
