import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, writeReport, envFor } from './fixtures.mjs';
import { parseFindings } from '../lib/tracker.mjs';

const TRACKER = path.join(ROOT, 'tracker.mjs');
const NORMALIZE = path.join(ROOT, 'normalize-statuses.mjs');
const DEDUP = path.join(ROOT, 'dedup-tracker.mjs');
const FIX_LINKS = path.join(ROOT, 'fix-report-links.mjs');

function cli(script, root, args = []) {
  return run(NODE, [script, ...args], { env: envFor(root) });
}

function readRows(root) {
  const file = path.join(root, 'data', 'findings.md');
  return parseFindings(fs.readFileSync(file, 'utf8')).rows;
}

test('tracker.mjs reports uninitialized and then initializes', () => {
  const root = tempRoot();
  try {
    const before = cli(TRACKER, root, ['--json']);
    assert.strictEqual(before.code, 0, formatRunFailure(before, 'tracker.mjs'));
    assert.deepStrictEqual(JSON.parse(before.stdout), { initialized: false, rows: [] });

    const init = cli(TRACKER, root, ['--init']);
    assert.strictEqual(init.code, 0, formatRunFailure(init, 'tracker --init'));
    const file = path.join(root, 'data', 'findings.md');
    assert.ok(fs.existsSync(file));

    const again = cli(TRACKER, root, ['--init']);
    assert.strictEqual(again.code, 0);
    assert.match(again.stdout, /already exists/);
  } finally {
    rmSync(root);
  }
});

test('tracker.mjs lists, filters, and limits rows', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', title: 'Data Analyst', url: 'https://jobs.example.com/posting/2', risk: 'High', status: 'Analyzed' }),
    ]);
    const all = cli(TRACKER, root, ['--json']);
    assert.strictEqual(all.code, 0);
    assert.strictEqual(JSON.parse(all.stdout).rows.length, 2);

    const byStatus = cli(TRACKER, root, ['--status', 'analyzed', '--json']);
    const statusRows = JSON.parse(byStatus.stdout).rows;
    assert.strictEqual(statusRows.length, 1);
    assert.strictEqual(statusRows[0].num, '2');

    const byRisk = cli(TRACKER, root, ['--risk', 'High', '--json']);
    assert.strictEqual(JSON.parse(byRisk.stdout).rows.length, 1);

    const found = cli(TRACKER, root, ['--find', 'analyst', '--json']);
    assert.strictEqual(JSON.parse(found.stdout).rows.length, 1);

    const limited = cli(TRACKER, root, ['--limit', '1', '--json']);
    assert.strictEqual(JSON.parse(limited.stdout).rows.length, 1);

    const plain = cli(TRACKER, root, ['--limit', '1']);
    assert.match(plain.stdout, /1 row\(s\)/);
  } finally {
    rmSync(root);
  }
});

test('normalize-statuses canonicalizes alias cells and logs the changes', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow({ status: 'pending' }),
      baseRow({ num: '2', status: 'pending', url: 'https://jobs.example.com/posting/2' }),
    ]);
    const result = cli(NORMALIZE, root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'normalize-statuses'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.changed, 2);
    const rows = readRows(root);
    assert.deepStrictEqual(rows.map((row) => row.status), ['Queued', 'Queued']);

    const log = fs.readFileSync(path.join(root, 'data', 'status-log.tsv'), 'utf8').trim().split(/\r?\n/);
    assert.strictEqual(log.length, 3, `header plus two entries: ${JSON.stringify(log)}`);
    const cells = log[1].split('\t');
    assert.strictEqual(cells[1], 'pending');
    assert.strictEqual(cells[2], 'Queued');
    assert.strictEqual(cells[3], 'script');
  } finally {
    rmSync(root);
  }
});

test('normalize-statuses refuses an unknown status and leaves it untouched', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ status: 'Nope' })]);
    const result = cli(NORMALIZE, root, ['--json']);
    assert.strictEqual(result.code, 1, formatRunFailure(result, 'normalize-statuses'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.ok, false);
    assert.ok(payload.invalid.some((item) => item.includes('Nope')));
    assert.strictEqual(readRows(root)[0].status, 'Nope');
  } finally {
    rmSync(root);
  }
});

test('normalize-statuses dry-run changes nothing', () => {
  const root = tempRoot();
  try {
    const file = writeTracker(root, [baseRow({ status: 'follow-up' })]);
    const before = fs.readFileSync(file, 'utf8');
    const result = cli(NORMALIZE, root, ['--dry-run', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'normalize-statuses'));
    assert.strictEqual(JSON.parse(result.stdout).changed, 1);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(fs.existsSync(path.join(root, 'data', 'status-log.tsv')), false);
  } finally {
    rmSync(root);
  }
});

test('dedup-tracker removes duplicate identities and keeps the first', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', title: 'Duplicate Posting', url: 'https://jobs.example.com/posting/1?utm_source=apply' }),
    ]);
    const result = cli(DEDUP, root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'dedup-tracker'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.removed.length, 1);
    assert.strictEqual(payload.removed[0].num, '2');
    assert.strictEqual(payload.removed[0].duplicateOf, '1');
    const rows = readRows(root);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].num, '1');
  } finally {
    rmSync(root);
  }
});

test('dedup-tracker dry-run leaves the file unchanged', () => {
  const root = tempRoot();
  try {
    const file = writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', url: 'https://jobs.example.com/posting/1' }),
    ]);
    const before = fs.readFileSync(file, 'utf8');
    const result = cli(DEDUP, root, ['--dry-run', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'dedup-tracker'));
    assert.strictEqual(JSON.parse(result.stdout).changed, 1);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(readRows(root).length, 2);
  } finally {
    rmSync(root);
  }
});

test('fix-report-links rewrites root-relative links and warns on missing targets', () => {
  const root = tempRoot();
  try {
    writeReport(root, '003-x.md');
    writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', status: 'Analyzed', url: 'https://jobs.example.com/posting/2', report: '[3](reports/003-x.md)' }),
      baseRow({ num: '3', status: 'Analyzed', url: 'https://jobs.example.com/posting/3', report: '[9](reports/009-missing.md)' }),
    ]);
    const result = cli(FIX_LINKS, root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'fix-report-links'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.changed, 1);
    assert.strictEqual(payload.warnings.length, 1);
    assert.match(payload.warnings[0], /009-missing\.md/);
    const rows = readRows(root);
    assert.strictEqual(rows[1].report, '[3](../reports/003-x.md)');
    assert.strictEqual(rows[2].report, '[9](reports/009-missing.md)');
  } finally {
    rmSync(root);
  }
});

test('fix-report-links dry-run rewrites nothing', () => {
  const root = tempRoot();
  try {
    writeReport(root, '003-x.md');
    const file = writeTracker(root, [
      baseRow({ status: 'Analyzed', report: '[3](reports/003-x.md)' }),
    ]);
    const before = fs.readFileSync(file, 'utf8');
    const result = cli(FIX_LINKS, root, ['--dry-run', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'fix-report-links'));
    assert.strictEqual(JSON.parse(result.stdout).changed, 1);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  } finally {
    rmSync(root);
  }
});