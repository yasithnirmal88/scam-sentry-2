import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import {
  tempRoot,
  baseRow,
  writeTracker,
  writeTrackerRaw,
  writeReport,
  writeAddition,
  writeStatusLog,
  writeReservations,
  envFor,
} from './fixtures.mjs';
import { COLUMNS } from '../lib/tracker.mjs';

const SCRIPT = path.join(ROOT, 'verify-pipeline.mjs');

function verify(root, extra = []) {
  const res = run(NODE, [SCRIPT, '--json', ...extra], { env: envFor(root) });
  assert.ok(res.code === 0 || res.code === 1, formatRunFailure(res, 'verify-pipeline'));
  return { res, payload: JSON.parse(res.stdout) };
}

function level(payload, id) {
  const check = payload.checks.find((entry) => entry.id === id);
  assert.ok(check, `missing check ${id}`);
  return check.level;
}

const headerRow = `| ${COLUMNS.map((column) => column.label).join(' | ')} |`;
const dividerRow = `| ${COLUMNS.map(() => '---').join(' | ')} |`;

test('a fresh root passes every check', () => {
  const root = tempRoot();
  try {
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.errors, 0);
    assert.strictEqual(payload.warnings, 0);
    assert.strictEqual(payload.checks.length, 18);
    for (const check of payload.checks) assert.strictEqual(check.level, 'ok', JSON.stringify(check));
  } finally {
    rmSync(root);
  }
});

test('a clean single-row tracker passes every check', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.errors, 0);
  } finally {
    rmSync(root);
  }
});

test('check 1 flags a non-canonical status', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ status: 'Weird' })]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(level(payload, 1), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 2 flags duplicate identities', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow(),
      baseRow({ num: '2', url: 'https://jobs.example.com/posting/1?utm_source=x' }),
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 2), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 3 flags a requires-report status with no report link', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ status: 'Analyzed' })]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 3), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 3 flags a report link whose file is missing', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow({ status: 'Analyzed', report: '[9](../reports/009-missing.md)' }),
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 3), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 4 flags an invalid risk cell', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ risk: 'Extreme' })]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 4), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 5 flags a malformed row', () => {
  const root = tempRoot();
  try {
    writeTrackerRaw(root, `${headerRow}\n${dividerRow}\n| 1 | 2026-10-08 | T | green | C | L | https://x.example/1 | - | - | Queued | - | n | EXTRA |\n`);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 5), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 6 flags an addition missing a required label', () => {
  const root = tempRoot();
  try {
    writeAddition(root, 'bad-labels.tsv', ['num', 'date', 'title', 'source', 'company', 'risk', 'confidence', 'status', 'report'], ['2', '2026-10-09', 'Role', 'lever', 'ACME', 'Low', 'High', 'Queued', '—']);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 6), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 7 flags bold markup inside cells', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ title: '**Very Important**' })]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 7), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 8 warns on stale reservations and cleans them with --fix', () => {
  const root = tempRoot();
  try {
    writeReservations(root, [{ start: 1, end: 5, timestamp: '2026-01-01T00:00:00.000Z' }]);
    const warning = verify(root);
    assert.strictEqual(warning.res.code, 0);
    assert.strictEqual(warning.payload.ok, true);
    assert.strictEqual(level(warning.payload, 8), 'warn');

    const fixed = verify(root, ['--fix']);
    assert.strictEqual(fixed.res.code, 0);
    assert.strictEqual(level(fixed.payload, 8), 'ok');

    const file = path.join(root, 'data', 'report-nums.reserved.tsv');
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 1, 'stale rows must be garbage-collected');
  } finally {
    rmSync(root);
  }
});

test('check 9 flags duplicate report numbers', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-a.md');
    writeReport(root, '001-b.md');
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 9), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 10 warns on orphan reports', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-unreferenced.md', goodReport);
    writeTracker(root, [baseRow()]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(level(payload, 10), 'warn');
  } finally {
    rmSync(root);
  }
});

test('check 11 errors on empty source cells', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow({ source: '' })]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 11), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 11 warns when the report disagrees with the tracker source', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-note.md', goodReport.replace('**Source:** greenhouse', '**Source:** indeed'));
    writeTracker(root, [
      baseRow({ status: 'Analyzed', report: '[1](../reports/001-note.md)' }),
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(level(payload, 11), 'warn');
  } finally {
    rmSync(root);
  }
});

test('check 12 flags duplicate tracker numbers', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [
      baseRow({ num: '4' }),
      baseRow({ num: '4', title: 'Another Four', url: 'https://jobs.example.com/posting/other' }),
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 12), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 13 flags a status log out of sync with the tracker', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    writeStatusLog(root, [
      { timestamp: '2026-10-08T00:00:00.000Z', prev: 'Queued', next: 'Analyzed', source: 'cli', num: '1', note: '' },
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 13), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 14 flags an invalid status log source', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    writeStatusLog(root, [
      { timestamp: '2026-10-08T00:00:00.000Z', prev: 'Queued', next: 'Queued', source: 'manual', num: '1', note: '' },
    ]);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 14), 'error');
  } finally {
    rmSync(root);
  }
});

test('--summary prints a machine-readable line', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const res = run(NODE, [SCRIPT, '--summary'], { env: envFor(root) });
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'verify-pipeline --summary'));
    assert.match(res.stdout, /^checks=\d+ ok=\d+ warn=\d+ error=0$/m);
  } finally {
    rmSync(root);
  }
});

const goodReport = `# Analysis: ACME — Senior Engineer

**Date:** 2026-10-08
**Legitimacy:** High Confidence
**Risk:** Low
**Confidence:** High
**Tracker:** [#1](../data/findings.md)
**URL:** https://jobs.example.com/posting/1
**Source:** greenhouse

<!-- machine-summary -->
\`\`\`yaml
company: ACME
role: Senior Engineer
legitimacy_tier: High Confidence
risk_level: Low
confidence: High
categories: [Likely Genuine]
indicators: []
final_decision: Consider
next_action: ""
hard_stops: []
soft_gaps: []
\`\`\`
<!-- /machine-summary -->

## A) Posting Facts

| Field | Value |
|---|---|
| Title | Senior Engineer |

## G) Posting Legitimacy

Signals are presented as evidence with legitimate explanations.

## Risk Assessment

**Level:** Low
**Categories:** Likely Genuine
**Confidence:** High

## Employer Verification

## Recommended Actions

1.

## Risk Summary

## Score Evidence

## Job Description (archived verbatim)

> Full JD pasted here verbatim.
`;

test('check 15 errors on an unknown provider claim in portals', () => {
  const root = tempRoot();
  try {
    writeTracker(root, [baseRow()]);
    const file = path.join(root, 'portals.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'entries:\n  - name: Ghost\n    integration: ghostboard\n', 'utf8');
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 15), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 16 errors on invisible control bytes in tracker cells', () => {
  const root = tempRoot();
  try {
    writeTrackerRaw(root, `${headerRow}\n${dividerRow}\n| 1 | 2026-10-08 | T\x01itle | green | C | L | https://x.example/1 | - | - | Queued | - | n |\n`);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 16), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 17 errors on a report without an archived JD', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-note.md', '## Analysis\n\nNo JD here.\n');
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 17), 'error');
  } finally {
    rmSync(root);
  }
});

test('check 18 errors on a contradictory risk layer', () => {
  const root = tempRoot();
  try {
    writeReport(
      root,
      '001-note.md',
      goodReport.replace('risk_level: Low', 'risk_level: Low').replace('legitimacy_tier: High Confidence', 'legitimacy_tier: Suspicious'),
    );
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 1);
    assert.strictEqual(level(payload, 18), 'error');
  } finally {
    rmSync(root);
  }
});

test('checks 17 and 18 pass for a well-formed report', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-good.md', goodReport);
    const { res, payload } = verify(root);
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'verify-pipeline well-formed report'));
    assert.strictEqual(level(payload, 17), 'ok');
    assert.strictEqual(level(payload, 18), 'ok');
  } finally {
    rmSync(root);
  }
});