#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot } from './lib/paths.mjs';
import { walkFiles } from './lib/files.mjs';
import {
  parseMachineSummary,
  validateMachineSummary,
  sectionOrder,
  tierForRiskLevel,
  determineRiskLevel,
  assignCategories,
  normalizeIndicatorCodes,
} from './lib/risk.mjs';

const FORBIDDEN_VERDICT_RE =
  /\b(?:definitely|certainly)\s+(?:a\s+)?(?:fake|scam)\b|\bthis\s+is\s+(?:a\s+)?(?:fake|scam)\b/i;

export function checkReport(text) {
  const findings = { hard: [], warnings: [] };
  const summary = parseMachineSummary(text);

  if (!summary) {
    findings.hard.push('missing machine summary block (<!-- machine-summary -->)');
    return findings;
  }

  for (const problem of validateMachineSummary(summary)) {
    findings.hard.push(`machine summary: ${problem}`);
  }

  const tiers = tierForRiskLevel(summary.risk_level);
  if (summary.risk_level && summary.legitimacy_tier && summary.legitimacy_tier !== tiers) {
    findings.hard.push(
      `legitimacy tier "${summary.legitimacy_tier}" does not follow risk level "${summary.risk_level}" (expected "${tiers}")`,
    );
  }

  const raw = Array.isArray(summary.indicators) ? summary.indicators.map(String) : [];
  const codes = normalizeIndicatorCodes(raw);
  if (summary.indicators !== undefined && codes.length !== raw.length) {
    findings.hard.push('indicators must all be known codes (C1..C4, H1..H5, M1..M4, L1..L3)');
  }
  if (summary.risk_level && codes.length) {
    const implied = determineRiskLevel(codes);
    if (implied !== summary.risk_level) {
      findings.hard.push(`risk_level "${summary.risk_level}" contradicts indicators (implied "${implied}")`);
    }
  }
  if (summary.categories && codes.length) {
    const implied = assignCategories(codes);
    const actual = new Set(summary.categories.map(String));
    if (actual.size === 0 || !implied.every((category) => actual.has(category))) {
      findings.hard.push('categories do not follow from the indicators');
    }
  }

  const sections = sectionOrder(text);
  if (sections.present.length === 0) {
    findings.warnings.push('no normative report sections found');
  } else if (!sections.regular) {
    findings.hard.push(`sections out of order: "${sections.firstBad}" precedes an earlier section`);
  }

  if (FORBIDDEN_VERDICT_RE.test(String(text ?? ''))) {
    findings.hard.push('report states a verdict ("definitely/this is a fake/scam") instead of signals');
  }

  return findings;
}

export function runRiskChecks(opts = {}) {
  const env = opts.env ?? process.env;
  const dataRoot = resolveDataRoot(env);
  const reportsDir = path.join(dataRoot, 'reports');
  const files = fs.existsSync(reportsDir) ? walkFiles(reportsDir, { ext: '.md' }) : [];
  const reports = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const findings = checkReport(text);
    reports.push({ file, ...findings, ok: findings.hard.length === 0 });
  }
  const hard = reports.filter((report) => !report.ok);
  const warningCount = reports.reduce((sum, report) => sum + report.warnings.length, 0);
  return { reports, hard, ok: hard.length === 0, warnings: warningCount };
}

function main(argv) {
  const asJson = argv.includes('--json');
  const summaryOnly = argv.includes('--summary');
  const report = runRiskChecks();
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  if (summaryOnly) {
    console.log(`reports=${report.reports.length} issues=${report.hard.reduce((s, r) => s + r.hard.length, 0)} warn=${report.warnings}`);
    return report.ok ? 0 : 1;
  }
  console.log(`verify-risk: ${report.reports.length} report(s)`);
  for (const item of report.reports) {
    const mark = item.ok ? 'ok  ' : 'FAIL';
    console.log(` ${mark} ${path.basename(item.file)}`);
    for (const message of item.hard) console.log(`      ${message}`);
    for (const message of item.warnings) console.log(`      [warn] ${message}`);
  }
  const total = report.hard.reduce((sum, item) => sum + item.hard.length, 0);
  console.log(`summary: ${total} hard finding(s), ${report.warnings} warning(s)`);
  return report.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));