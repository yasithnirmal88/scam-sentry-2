import { test } from 'node:test';
import assert from 'node:assert';
import {
  assessRisk,
  determineRiskLevel,
  assignCategories,
  determineConfidence,
  tierForRiskLevel,
  normalizeIndicatorCodes,
  parseMachineSummary,
  renderMachineSummary,
  validateMachineSummary,
  sectionOrder,
  isKnownIndicator,
} from '../lib/risk.mjs';

test('normalizeIndicatorCodes dedupes and uppercases', () => {
  assert.deepEqual(normalizeIndicatorCodes('c1, h2, C1'), ['C1', 'H2']);
  assert.deepEqual(normalizeIndicatorCodes(['m3', 'm3']), ['M3']);
  assert.deepEqual(normalizeIndicatorCodes(''), []);
});

test('that any critical indicator forces Critical', () => {
  assert.strictEqual(assessRisk('C1').level, 'Critical');
  assert.strictEqual(assessRisk('C2,M1').level, 'Critical');
});

test('risk determination follows first-match-wins', () => {
  assert.strictEqual(determineRiskLevel(['H1', 'H2']), 'High');
  assert.strictEqual(determineRiskLevel(['H1', 'M1', 'M2']), 'High');
  assert.strictEqual(determineRiskLevel(['H1']), 'Medium');
  assert.strictEqual(determineRiskLevel(['M1', 'M2']), 'Medium');
  assert.strictEqual(determineRiskLevel(['M1']), 'Low');
  assert.strictEqual(determineRiskLevel([]), 'Low');
});

test('categories are multi-label and follow indicators', () => {
  assert.deepEqual(assignCategories(['H1']), ['Scam']);
  assert.deepEqual(assignCategories(['H4']), ['Scam']);
  assert.deepEqual(assignCategories(['H5', 'M1']), ['Ghost/Stale', 'Suspicious']);
  assert.deepEqual(assignCategories(['L2']), ['Likely Genuine']);
  assert.deepEqual(assignCategories([]), ['Likely Genuine']);
});

test('confidence bands respond to evidence volume', () => {
  assert.strictEqual(determineConfidence(['C1', 'C2', 'H1', 'H2']), 'High');
  assert.strictEqual(determineConfidence(['M1'], 'Low'), 'Medium');
  assert.strictEqual(determineConfidence(['L1'], 'Low'), 'Low');
});

test('legitimacy tiers follow risk levels', () => {
  assert.strictEqual(tierForRiskLevel('Critical'), 'Suspicious');
  assert.strictEqual(tierForRiskLevel('High'), 'Suspicious');
  assert.strictEqual(tierForRiskLevel('Medium'), 'Proceed with Caution');
  assert.strictEqual(tierForRiskLevel('Low'), 'High Confidence');
});

test('machine summary round-trips through YAML and validates', () => {
  const summary = {
    company: 'ACME',
    role: 'Senior Engineer',
    legitimacy_tier: 'High Confidence',
    risk_level: 'Low',
    confidence: 'High',
    categories: ['Likely Genuine'],
    indicators: [],
    final_decision: 'Consider',
  };
  const block = renderMachineSummary(summary);
  assert.match(block, /<!-- machine-summary -->/);
  const parsed = parseMachineSummary(block);
  assert.equal(parsed.role, 'Senior Engineer');
  assert.equal(parsed.legitimacy_tier, 'High Confidence');
  assert.deepEqual(validateMachineSummary(parsed), []);
});

test('validateMachineSummary catches enum drift', () => {
  assert.deepEqual(validateMachineSummary(null), ['machine summary must be a YAML object']);
  const problems = validateMachineSummary({
    role: 'R',
    company: 'C',
    legitimacy_tier: 'Definitely Legit',
    risk_level: 'Vibes',
    confidence: 'Certain',
    categories: ['Meh'],
    indicators: ['NOT_A_CODE'],
    final_decision: 'Not sure',
  });
  assert.ok(problems.some((p) => p.includes('legitimacy_tier')));
  assert.ok(problems.some((p) => p.includes('risk_level')));
  assert.ok(problems.some((p) => p.includes('confidence')));
  assert.ok(problems.some((p) => p.includes('final_decision')));
});

test('sectionOrder demands the normative report chain', () => {
  const ok = sectionOrder('## A) Posting Facts\n\n## G) Posting Legitimacy\n\n## Risk Assessment\n\n## Employer Verification\n\n## Recommended Actions\n\n## Risk Summary\n\n## Score Evidence\n\n## Job Description (archived verbatim)\n');
  assert.equal(ok.regular, true);
  const bad = sectionOrder('## G) Posting Legitimacy\n\n## A) Posting Facts\n');
  assert.equal(bad.regular, false);
  assert.equal(bad.firstBad, '## A) Posting Facts');
});

test('indicator registry is consistent', () => {
  for (const code of ['C1', 'C2', 'C3', 'C4', 'H1', 'H2', 'H3', 'H4', 'H5', 'M1', 'M2', 'M3', 'M4', 'L1', 'L2', 'L3']) {
    assert.ok(isKnownIndicator(code), `known indicator ${code}`);
  }
  assert.equal(isKnownIndicator('NOPE'), false);
});