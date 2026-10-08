import path from 'node:path';
import { ROOT, NODE, run, pass, fail, formatRunFailure } from './helpers.mjs';

const result = run(NODE, [path.join(ROOT, 'scripts', 'check-syntax.mjs')]);
if (result.code === 0) {
  pass('every .mjs file parses');
} else {
  fail('every .mjs file parses', formatRunFailure(result, 'syntax check'));
}
