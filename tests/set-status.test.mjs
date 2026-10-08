import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, envFor } from './fixtures.mjs';
import { parseFindings } from '../lib/tracker.mjs';

const SCRIPT = path.join(ROOT, 'set-status.mjs');

function setStatus(root, args) {
  return run(NODE, [SCRIPT, ...args], { env: envFor(root) });
}

function readRows(root) {
  const file = path.join(root, 'data', 'findings.md');
  return parseFindings(fs.readFileSync(file, 'utf8')).rows;
}

function readLog(root) {
  const file = path.join(root, 'data', 'status-log.tsv');
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
}

test('updates the cell and appends the status log', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = setStatus(root, ['1', 'Followup', '--note', 'needs a recheck', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'set-status'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.prev, 'Queued');
    assert.strictEqual(payload.next, 'Followup');
    const rows = readRows(root);
    assert.strictEqual(rows[0].status, 'Followup');
    const log = readLog(root);
    assert.strictEqual(log.length, 2, `expected header plus one entry: ${JSON.stringify(log)}`);
    const cells = log[1].split('\t');
    assert.strictEqual(cells[1], 'Queued');
    assert.strictEqual(cells[2], 'Followup');
    assert.strictEqual(cells[3], 'cli');
    assert.strictEqual(cells[4], '1');
    assert.strictEqual(cells[5], 'needs a recheck');
  } finally {
    rmSync(root);
  }
});

test('accepts aliases and stores the canonical spelling', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = setStatus(root, ['1', 'follow-up', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'set-status'));
    assert.strictEqual(JSON.parse(result.stdout).next, 'Followup');
    assert.strictEqual(readRows(root)[0].status, 'Followup');
  } finally {
    rmSync(root);
  }
});

test('selects a row by title substring', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow(), baseRow({ num: '2', title: 'Data Analyst', url: 'https://jobs.example.com/posting/2' })]);
    const result = setStatus(root, ['analyst', 'Analyzed', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'set-status'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.num, '2');
    assert.strictEqual(readRows(root)[1].status, 'Analyzed');
    assert.strictEqual(readRows(root)[0].status, 'Queued');
  } finally {
    rmSync(root);
  }
});

test('rejects an unknown state with an exit code of 2', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = setStatus(root, ['1', 'Mystery', '--json']);
    assert.strictEqual(result.code, 2, formatRunFailure(result, 'set-status'));
    assert.match(result.stderr, /unknown state/);
    assert.strictEqual(readRows(root)[0].status, 'Queued');
  } finally {
    rmSync(root);
  }
});

test('ambiguous selectors exit 3 without touching the tracker', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', url: 'https://jobs.example.com/posting/2' }),
    ]);
    const before = fs.readFileSync(path.join(root, 'data', 'findings.md'), 'utf8');
    const result = setStatus(root, ['Senior', 'Analyzed', '--json']);
    assert.strictEqual(result.code, 3, formatRunFailure(result, 'set-status'));
    assert.match(JSON.parse(result.stdout).error, /ambiguous selector/);
    const after = fs.readFileSync(path.join(root, 'data', 'findings.md'), 'utf8');
    assert.strictEqual(after, before);
  } finally {
    rmSync(root);
  }
});

test('no match exits 3', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = setStatus(root, ['nothing-matches', 'Analyzed']);
    assert.strictEqual(result.code, 3, formatRunFailure(result, 'set-status'));
  } finally {
    rmSync(root);
  }
});

test('setting the same state twice is idempotent and logs once', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const first = setStatus(root, ['1', 'Analyzed', '--json']);
    assert.strictEqual(first.code, 0, formatRunFailure(first, 'set-status'));
    const second = setStatus(root, ['1', 'Analyzed', '--json']);
    assert.strictEqual(second.code, 0, formatRunFailure(second, 'set-status'));
    assert.strictEqual(JSON.parse(second.stdout).unchanged, true);
    assert.strictEqual(readLog(root).length, 2, 'only the first change should be logged');
  } finally {
    rmSync(root);
  }
});

test('dry-run reports the transition without writing', () => {
  const root = tempRoot();
  try {
    const file = writeTracker(root, [baseRow()]);
    const before = fs.readFileSync(file, 'utf8');
    const result = setStatus(root, ['1', 'Confirmed', '--dry-run', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'set-status'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(payload.next, 'Confirmed');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(fs.existsSync(path.join(root, 'data', 'status-log.tsv')), false);
  } finally {
    rmSync(root);
  }
});

test('a missing tracker exits 5', () => {
  const root = tempRoot();
  try {
    const result = setStatus(root, ['1', 'Analyzed', '--json']);
    assert.strictEqual(result.code, 5, formatRunFailure(result, 'set-status'));
    assert.match(JSON.parse(result.stdout).error, /tracker not initialized/);
  } finally {
    rmSync(root);
  }
});

test('an invalid --source value exits 2', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = setStatus(root, ['1', 'Analyzed', '--source', 'manual']);
    assert.strictEqual(result.code, 2, formatRunFailure(result, 'set-status'));
    assert.match(result.stderr, /source must be one of/);
  } finally {
    rmSync(root);
  }
});
