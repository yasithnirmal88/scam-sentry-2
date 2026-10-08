import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { ROOT, NODE, run, formatRunFailure, rmSync } from './helpers.mjs';
import { tempRoot, writeReport, envFor } from './fixtures.mjs';
import { checkReport, runRiskChecks } from '../verify-risk.mjs';

const SCRIPT = path.join(ROOT, 'verify-risk.mjs');

const MINIMAL = `# Analysis: ACME — Senior Engineer

<!-- machine-summary -->
\`\`\`yaml
company: ACME
role: Senior Engineer
legitimacy_tier: High Confidence
risk_level: Low
confidence: High
categories: [Likely Genuine]
indicators: []
\`\`\`
<!-- /machine-summary -->

## A) Posting Facts

## G) Posting Legitimacy

## Risk Assessment

## Employer Verification

## Recommended Actions

## Risk Summary

## Score Evidence

## Job Description (archived verbatim)

> JD.
`;

test('a coherent report passes', () => {
  const findings = checkReport(MINIMAL);
  assert.deepEqual(findings, { hard: [], warnings: [] });
});

test('a report without the machine summary is a hard finding', () => {
  const { hard } = checkReport('# Analysis\n\n## Risk Assessment\n');
  assert.ok(hard.some((message) => message.includes('missing machine summary')));
});

test('risk level contradicting its indicators is a hard finding', () => {
  const { hard } = checkReport(
    MINIMAL.replace('risk_level: Low', 'risk_level: High').replace('indicators: []', 'indicators: [M1, M2]'),
  );
  assert.ok(hard.some((message) => message.includes('contradicts indicators')), hard.join('; '));
});

test('legitimacy tier contradicting the risk level is a hard finding', () => {
  const { hard } = checkReport(MINIMAL.replace('legitimacy_tier: High Confidence', 'legitimacy_tier: Suspicious'));
  assert.ok(hard.some((message) => message.includes('does not follow risk level')), hard.join('; '));
});

test('out-of-order normative sections are flagged', () => {
  const moved = MINIMAL
    .replace('## A) Posting Facts\n', '## G) Posting Legitimacy\n\n## A) Posting Facts\n')
    .replace('## G) Posting Legitimacy\n\n## Risk Assessment', '\n## Risk Assessment');
  const { hard } = checkReport(moved);
  assert.ok(hard.some((message) => message.includes('out of order')), hard.join('; '));
});

test('verdict language is rejected', () => {
  const verdict = MINIMAL.replace('> JD.\n', '> This is definitely a scam.\n');
  const { hard } = checkReport(verdict);
  assert.ok(hard.some((message) => message.includes('verdict')), hard.join('; '));
});

test('--summary prints a machine-readable line', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-note.md', MINIMAL);
    const res = run(NODE, [SCRIPT, '--summary'], { env: envFor(root) });
    assert.strictEqual(res.code, 0, formatRunFailure(res, 'verify-risk --summary'));
    assert.match(res.stdout, /^reports=\d+ issues=\d+ warn=\d+$/m);
  } finally {
    rmSync(root);
  }
});

test('runRiskChecks aggregates reports and exits non-zero on hard findings', () => {
  const root = tempRoot();
  try {
    writeReport(root, '001-good.md', MINIMAL);
    writeReport(root, '002-bad.md', '# Nope\n\n## Risk Assessment\n');
    const result = runRiskChecks({ env: envFor(root) });
    assert.strictEqual(result.reports.length, 2);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.hard.length, 1);
    const res = run(NODE, [SCRIPT, '--json'], { env: envFor(root) });
    assert.strictEqual(res.code, 1, formatRunFailure(res, 'verify-risk --json'));
  } finally {
    rmSync(root);
  }
});