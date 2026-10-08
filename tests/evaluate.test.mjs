import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, envFor } from './fixtures.mjs';
import { buildReport, formatReportName, renderReport } from '../evaluate.mjs';
import { parseMachineSummary } from '../lib/risk.mjs';

const SCRIPT = path.join(ROOT, 'evaluate.mjs');

test('buildReport computes risk and writes a machine summary', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const result = buildReport({
      row: baseRow(),
      reportNum: 1,
      indicatorInput: 'h2,m3',
      summary: { final_decision: 'Consider' },
      env: envFor(root),
    });
    assert.strictEqual(result.risk.level, 'Medium');
    assert.strictEqual(result.risk.legitimacyTier, 'Proceed with Caution');
    assert.ok(result.body.includes('## Risk Assessment'));
    assert.ok(result.body.includes('## Job Description (archived verbatim)'));
    const machine = parseMachineSummary(result.body);
    assert.strictEqual(machine.risk_level, 'Medium');
    assert.strictEqual(machine.legitimacy_tier, 'Proceed with Caution');
    assert.deepEqual(machine.categories, ['Suspicious']);
    assert.strictEqual(result.problems.length, 0);
  } finally {
    rmSync(root);
  }
});

test('a critical indicator escalates the report', () => {
  const result = buildReport({
    row: baseRow(),
    reportNum: 2,
    indicatorInput: 'c1, c1, h4',
    summary: {},
    env: {},
  });
  assert.strictEqual(result.risk.level, 'Critical');
  assert.strictEqual(result.risk.legitimacyTier, 'Suspicious');
  assert.deepEqual(result.risk.categories, ['Scam']);
  assert.ok(result.body.includes('| C1'), 'escalated indicator appears in the table');
});

test('--json writes a report for an existing row', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const res = run(NODE, [SCRIPT, '1', '--indicators', 'h2', '--final-decision', 'Research first', '--json'], {
      env: envFor(root),
    });
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'evaluate --json'));
    const payload = JSON.parse(res.stdout);
    assert.strictEqual(payload.num, '1');
    assert.strictEqual(payload.report, 2);
    assert.ok(fs.existsSync(path.join(root, 'reports', formatReportName({ reportNum: 2, company: 'ACME', title: 'Senior Engineer' }))));
  } finally {
    rmSync(root);
  }
});

test('--dry-run does not write anything', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const res = run(NODE, [SCRIPT, '1', '--dry-run', '--json'], { env: envFor(root) });
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'evaluate --dry-run'));
    const payload = JSON.parse(res.stdout);
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(fs.existsSync(path.join(root, 'reports')), false);
  } finally {
    rmSync(root);
  }
});

test('invalid final decision is rejected', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const res = run(NODE, [SCRIPT, '1', '--final-decision', 'Maybe', '--json'], { env: envFor(root) });
    assert.strictEqual(res.code, 2);
  } finally {
    rmSync(root);
  }
});

test('ambiguous selector is rejected', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow(), baseRow({ num: '2', title: 'Staff Engineer' })]);
    const res = run(NODE, [SCRIPT, 'Engineer', '--json'], { env: envFor(root) });
    assert.strictEqual(res.code, 3);
    const payload = JSON.parse(res.stdout);
    assert.ok(payload.error.includes('ambiguous'));
  } finally {
    rmSync(root);
  }
});

test('renderReport builds a normative report document', () => {
  const risk = { level: 'Low', legitimacyTier: 'High Confidence', confidence: 'High', categories: ['Likely Genuine'], indicators: [] };
  const body = renderReport({
    row: baseRow(),
    reportNum: 7,
    risk,
    summary: { final_decision: 'Consider' },
  });
  assert.ok(body.includes('## A) Posting Facts'));
  assert.ok(body.includes(`| URL | https://jobs.example.com/posting/1 |`));
});