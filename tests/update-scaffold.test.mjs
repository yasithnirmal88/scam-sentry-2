import path from 'node:path';
import { ROOT, NODE, run, pass, fail } from './helpers.mjs';

const updater = path.join(ROOT, 'update-system.mjs');

const check = run(NODE, [updater, 'check', '--json']);
if (check.code !== 0) {
  fail('update check exits 0', check.stderr);
} else {
  let payload = null;
  try {
    payload = JSON.parse(check.stdout);
  } catch {
    payload = null;
  }
  if (payload && payload.updateAvailable === false && typeof payload.current === 'string' && payload.current.length) {
    pass(`update check reports current ${payload.current}`);
  } else {
    fail('update check payload shape', check.stdout);
  }
}

const apply = run(NODE, [updater, 'apply', '--json']);
if (apply.code === 1) {
  pass('apply refuses while no update source is configured');
} else {
  fail('apply refuses while no update source is configured', `exit ${apply.code}`);
}

const unknown = run(NODE, [updater, 'frobnicate', '--json']);
if (unknown.code === 2) {
  pass('an unknown updater command exits 2');
} else {
  fail('an unknown updater command exits 2', `exit ${unknown.code}`);
}
