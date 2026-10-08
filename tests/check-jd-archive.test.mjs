import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, writeReport, envFor } from './fixtures.mjs';
import { checkReportArchive, runArchiveChecks } from '../check-jd-archive.mjs';

const SCRIPT = path.join(ROOT, 'check-jd-archive.mjs');

test('a report with a verbatim JD section passes', () => {
  const result = checkReportArchive('# Analysis\n\n## Job Description (archived verbatim)\n\n> JD text.\n');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.verbatim, true);
  assert.deepEqual(result.problems, []);
});

test('a report without an archived JD is flagged', () => {
  const result = checkReportArchive('# Analysis\n\n## Risk Assessment\n');
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((message) => message.includes('neither a verbatim JD')));
});

test('a stale capture reference is flagged as missing', () => {
  const problems = checkReportArchive(
    '# Analysis\n\nJD archived at [jds/001-jd.md](../jds/001-jd.md)\n\n## A) Posting Facts\n',
    { jdsDir: '/tmp/nonexistent-jds' },
  );
  assert.strictEqual(problems.ok, false);
  assert.ok(problems.problems.some((message) => message.includes('missing')), problems.problems.join('; '));
});

test('a capture reference missing from the jds directory fails', () => {
  const jdsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-jd-'));
  try {
    const result = checkReportArchive(
      '# Analysis\n\nArchived JD is at jds/001-jd.md.\n\n## A) Posting Facts\n',
      { jdsDir },
    );
    assert.strictEqual(result.ok, false);
    assert.ok(result.problems.some((message) => message.includes('missing')), result.problems.join('; '));
  } finally {
    fs.rmSync(jdsDir, { recursive: true, force: true });
  }
});

test('an existing capture reference passes', () => {
  const jdsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-jd-'));
  try {
    fs.writeFileSync(path.join(jdsDir, '001-jd.md'), 'JD\n', 'utf8');
    const result = checkReportArchive(
      '# Analysis\n\nArchived JD is at jds/001-jd.md.\n\n## A) Posting Facts\n',
      { jdsDir },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.verbatim, false);
    assert.strictEqual(result.capture, 'jds/001-jd.md');
  } finally {
    fs.rmSync(jdsDir, { recursive: true, force: true });
  }
});

test('runArchiveChecks flags missing captures', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-ok.md', '# A\n\n## Job Description (archived verbatim)\n\n> JD\n');
    writeReport(root, '002-missing.md', '# B\n\nNo JD anywhere.\n');
    const result = runArchiveChecks({ env: envFor(root) });
    assert.strictEqual(result.reports.length, 2);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.bad.length, 1);
    const res = run(NODE, [SCRIPT, '--summary'], { env: envFor(root) });
    assert.strictEqual(res.code, 1, formatRunFailure(res, 'check-jd-archive --summary'));
    assert.match(res.stdout, /^reports=\d+ missing=\d+$/m);
  } finally {
    rmSync(root);
  }
});

test('--json reports per-file results', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-ok.md', '# A\n\n## Job Description (archived verbatim)\n\n> JD\n');
    const res = run(NODE, [SCRIPT, '--json'], { env: envFor(root) });
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'check-jd-archive --json'));
    const payload = JSON.parse(res.stdout);
    assert.strictEqual(payload.ok, true);
  } finally {
    rmSync(root);
  }
});