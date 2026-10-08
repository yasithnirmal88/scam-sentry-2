import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, writeReport, envFor } from './fixtures.mjs';

const SCRIPT = path.join(ROOT, 'reserve-report-num.mjs');

function reserve(root, args) {
  return run(NODE, [SCRIPT, ...args], { env: envFor(root) });
}

test('reserves sequential ranges on a fresh root', () => {
  const root = tempRoot();
  try {
    const first = reserve(root, ['--count', '3', '--json']);
    assert.strictEqual(first.code, 0, formatRunFailure(first, 'reserve-report-num'));
    assert.strictEqual(JSON.parse(first.stdout).label, '001-003');

    const second = reserve(root, ['--count', '1', '--json']);
    assert.strictEqual(second.code, 0, formatRunFailure(second, 'reserve-report-num'));
    assert.strictEqual(JSON.parse(second.stdout).label, '004');
  } finally {
    rmSync(root);
  }
});

test('skips numbers used by tracker rows and existing reports', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ num: '5', url: 'https://jobs.example.com/posting/5' })]);
    writeReport(root, '007-note.md');
    const result = reserve(root, ['--count', '1', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'reserve-report-num'));
    assert.strictEqual(JSON.parse(result.stdout).label, '008');
  } finally {
    rmSync(root);
  }
});

test('releases a reservation once', () => {
  const root = tempRoot();
  try {
    const first = reserve(root, ['--count', '1', '--json']);
    assert.strictEqual(first.code, 0, formatRunFailure(first, 'reserve-report-num'));

    const released = reserve(root, ['--release', '001', '--json']);
    assert.strictEqual(released.code, 0, formatRunFailure(released, 'reserve-report-num'));
    assert.strictEqual(JSON.parse(released.stdout).ok, true);

    const again = reserve(root, ['--release', '001', '--json']);
    assert.strictEqual(again.code, 2, formatRunFailure(again, 'reserve-report-num'));
    assert.match(JSON.parse(again.stdout).error, /no reservation matches/);
  } finally {
    rmSync(root);
  }
});

test('rejects a bad --count', () => {
  const root = tempRoot();
  try {
    for (const count of ['0', '1001', 'abc']) {
      const result = reserve(root, ['--count', count, '--json']);
      assert.strictEqual(result.code, 2, formatRunFailure(result, `reserve --count ${count}`));
      assert.match(JSON.parse(result.stdout).error, /--count must be an integer/);
    }
  } finally {
    rmSync(root);
  }
});

test('rejects combining --release with --count', () => {
  const root = tempRoot();
  try {
    const result = reserve(root, ['--release', '001', '--count', '1']);
    assert.strictEqual(result.code, 2, formatRunFailure(result, 'reserve-report-num'));
  } finally {
    rmSync(root);
  }
});

test('a reservation file is created and survives lock cleanup', () => {
  const root = tempRoot();
  try {
    const result = reserve(root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'reserve-report-num'));
    const file = path.join(root, 'data', 'report-nums.reserved.tsv');
    assert.ok(fs.existsSync(file));
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 2, `header plus one reservation: ${JSON.stringify(lines)}`);
    assert.strictEqual(lines[0], 'start\tend\ttimestamp');
    const cells = lines[1].split('\t');
    assert.strictEqual(cells[0], '1');
    assert.strictEqual(cells[1], '1');
    assert.ok(Date.parse(cells[2]), `timestamp must parse: ${cells[2]}`);
    assert.strictEqual(fs.existsSync(path.join(root, 'data', '.tracker.lock')), false);
  } finally {
    rmSync(root);
  }
});