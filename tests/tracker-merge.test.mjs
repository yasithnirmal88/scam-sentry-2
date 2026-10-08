import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, writeReport, writeAddition, envFor } from './fixtures.mjs';
import { parseFindings } from '../lib/tracker.mjs';

const SCRIPT = path.join(ROOT, 'merge-tracker.mjs');

const ADDITION_LABELS = [
  'num',
  'date',
  'title',
  'source',
  'company',
  'url',
  'risk',
  'confidence',
  'status',
  'report',
];

function merge(root, args = []) {
  return run(NODE, [SCRIPT, ...args], { env: envFor(root) });
}

function readRows(root) {
  const file = path.join(root, 'data', 'findings.md');
  return parseFindings(fs.readFileSync(file, 'utf8')).rows;
}

test('merges a valid addition, rewrites the report link, and archives the TSV', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    writeReport(root, '002-acme-engineer.md');
    const addition = writeAddition(
      root,
      '002-acme.tsv',
      ADDITION_LABELS,
      [
        '2',
        '2026-10-09',
        'Backend Engineer',
        'lever',
        'Globex',
        'https://jobs.example.com/posting/2',
        'Medium',
        'High',
        'Analyzed',
        '[2](reports/002-acme-engineer.md)',
      ],
    );

    const result = merge(root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'merge-tracker'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.merged, 1);
    assert.strictEqual(payload.skipped.length, 0);

    const rows = readRows(root);
    assert.strictEqual(rows.length, 2);
    const merged = rows.find((row) => row.num === '2');
    assert.ok(merged, 'the merged row must exist');
    assert.strictEqual(merged.status, 'Analyzed');
    assert.strictEqual(merged.risk, 'Medium');
    assert.strictEqual(merged.report, '[2](../reports/002-acme-engineer.md)');
    assert.strictEqual(merged.company, 'Globex');

    assert.strictEqual(fs.existsSync(addition), false, 'the consumed TSV must move');
    assert.ok(fs.existsSync(path.join(root, 'data', 'additions', 'merged', '002-acme.tsv')));

    const second = merge(root, ['--json']);
    assert.strictEqual(second.code, 0, formatRunFailure(second, 'merge-tracker'));
    assert.strictEqual(JSON.parse(second.stdout).merged, 0);
  } finally {
    rmSync(root);
  }
});

test('refuses an invalid addition without touching the tracker', () => {
  const root = tempRoot();
  try {
    const trackerFile = writeTracker(root, [baseRow()]);
    const before = fs.readFileSync(trackerFile, 'utf8');
    const addition = writeAddition(
      root,
      'bad-risk.tsv',
      ADDITION_LABELS,
      ['3', '2026-10-09', 'Tester', 'indeed', 'Globex', 'https://jobs.example.com/posting/3', 'Extreme', 'High', 'Queued', '—'],
    );

    const result = merge(root, ['--json']);
    assert.strictEqual(result.code, 1, formatRunFailure(result, 'merge-tracker'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.ok, false);
    assert.ok(payload.errors.some((error) => error.includes('bad-risk.tsv')));
    assert.strictEqual(fs.readFileSync(trackerFile, 'utf8'), before);
    assert.ok(fs.existsSync(addition), 'the rejected TSV must stay put');
  } finally {
    rmSync(root);
  }
});

test('skips duplicate identities by normalized url', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const addition = writeAddition(
      root,
      'dup-url.tsv',
      ADDITION_LABELS,
      ['4', '2026-10-09', 'Same Job', 'lever', 'ACME', 'https://jobs.example.com/posting/1?utm_source=board', 'Low', 'High', 'Queued', '—'],
    );

    const result = merge(root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'merge-tracker'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.merged, 0);
    assert.strictEqual(payload.skipped.length, 1);
    assert.strictEqual(payload.skipped[0].duplicateOf, '1');
    assert.strictEqual(readRows(root).length, 1);
    assert.ok(fs.existsSync(addition), 'skipped TSVs stay in the additions dir');
  } finally {
    rmSync(root);
  }
});

test('sorts merged rows by number', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ num: '5', url: 'https://jobs.example.com/posting/5' })]);
    writeAddition(
      root,
      '003-third.tsv',
      ADDITION_LABELS,
      ['3', '2026-10-09', 'First', 'greenhouse', 'ACME', 'https://jobs.example.com/posting/3', 'Low', 'Medium', 'Queued', '—'],
    );
    const result = merge(root, ['--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'merge-tracker'));
    const nums = readRows(root).map((row) => row.num);
    assert.deepStrictEqual(nums, ['3', '5']);
  } finally {
    rmSync(root);
  }
});

test('dry-run reports the merge without archiving or writing', () => {
  const root = tempRoot();
  try {
    const trackerFile = writeTracker(root, [baseRow()]);
    const before = fs.readFileSync(trackerFile, 'utf8');
    const addition = writeAddition(
      root,
      '006-sixth.tsv',
      ADDITION_LABELS,
      ['6', '2026-10-09', 'Sixth Role', 'lever', 'ACME', 'https://jobs.example.com/posting/6', 'Low', 'Low', 'Queued', '—'],
    );

    const result = merge(root, ['--dry-run', '--json']);
    assert.strictEqual(result.code, 0, formatRunFailure(result, 'merge-tracker'));
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.merged, 1);
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(fs.readFileSync(trackerFile, 'utf8'), before);
    assert.ok(fs.existsSync(addition), 'dry-run must not archive the TSV');
    assert.strictEqual(readRows(root).length, 1);
  } finally {
    rmSync(root);
  }
});