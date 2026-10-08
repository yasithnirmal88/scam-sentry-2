#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, resolveTrackerRead } from './lib/paths.mjs';
import { parseFindings, slug, atomicWrite, TrackerError, withLock } from './lib/tracker.mjs';
import { assessRisk, renderMachineSummary, validateMachineSummary, LEGITIMACY_TIERS, RISK_LEVELS, CONFIDENCE_LEVELS, FINAL_DECISIONS } from './lib/risk.mjs';

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function usage(message) {
  console.error(message);
  console.error(
    'usage: node evaluate.mjs <report#|title-substring> [--indicators C1,H2,M3] [--final-decision Apply|Consider|Research first|Skip] [--next-action "<text>"] [--dry-run] [--json]',
  );
  return 2;
}

function collectNumbers(dataRoot, env, trackerPath) {
  const used = new Set();
  if (fs.existsSync(trackerPath)) {
    for (const row of parseFindings(fs.readFileSync(trackerPath, 'utf8')).rows) {
      if (!row.malformed && /^\d+$/.test(row.num)) used.add(Number(row.num));
    }
  }
  const reportsDir = path.join(dataRoot, 'reports');
  if (fs.existsSync(reportsDir)) {
    for (const name of fs.readdirSync(reportsDir)) {
      const match = name.match(/^(\d+)[-.]/);
      if (match) used.add(Number(match[1]));
    }
  }
  return used;
}

export function renderReport({ row, reportNum, risk, summary }) {
  const safeSummary = summary ?? {};
  const facts = [
    '| Field | Value |',
    '|---|---|',
    `| Title | ${row.title} |`,
    `| Company | ${row.company ?? ''} |`,
    `| Location | ${row.location ?? ''} |`,
    `| Posted | ${row.date ?? ''} |`,
    `| URL | ${row.url ?? ''} |`,
  ].join('\n');

  const indicatorRows = risk.indicators.length
    ? risk.indicators.map((indicator) => `| ${indicator.code} | ${indicator.severity} | ${indicator.label} |`).join('\n')
    : '| — | — | _no indicators recorded_ |';

  const decision = safeSummary.final_decision ?? '';
  const nextAction = safeSummary.next_action ?? '';
  const hardStops = Array.isArray(safeSummary.hard_stops) ? safeSummary.hard_stops : [];
  const softGaps = Array.isArray(safeSummary.soft_gaps) ? safeSummary.soft_gaps : [];

  return [
    `# Analysis: ${row.company ?? 'Unknown'} — ${row.title}`,
    '',
    `**Date:** ${row.date ?? ''}`,
    `**Legitimacy:** ${risk.legitimacyTier}`,
    `**Risk:** ${risk.level}`,
    `**Confidence:** ${risk.confidence}`,
    `**Tracker:** [#${row.num}](../data/findings.md)`,
    `**URL:** ${row.url ?? ''}`,
    `**Source:** ${row.source ?? ''}`,
    '',
    renderMachineSummary({
      company: (row.company ?? '').trim(),
      role: row.title,
      legitimacy_tier: risk.legitimacyTier,
      risk_level: risk.level,
      confidence: risk.confidence,
      categories: risk.categories,
      indicators: risk.indicators,
      final_decision: decision,
      next_action: nextAction,
      hard_stops: hardStops,
      soft_gaps: softGaps,
      risk_summary: {
        legitimacy: 'pass',
        classification: 'pass',
        culture: 'pass',
        interview_redflags: 'pass',
      },
    }),
    '',
    '## A) Posting Facts',
    '',
    facts,
    '',
    '## G) Posting Legitimacy',
    '',
    'Signals are presented as evidence with legitimate explanations; the human decides.',
    '',
    '- Posting age:',
    '- Apply button state:',
    '- Tech specificity:',
    '- Requirements realism:',
    '- Salary transparency:',
    '- Role-company fit:',
    '- Repost pattern:',
    '- Anomaly notes:',
    '',
    '## Risk Assessment',
    '',
    `**Level:** ${risk.level}`,
    `**Categories:** ${risk.categories.join(', ')}`,
    `**Confidence:** ${risk.confidence}`,
    '',
    '**Indicators**',
    '',
    '| Code | Severity | Detail |',
    '|---|---|---|',
    indicatorRows,
    '',
    'Language discipline: speak in signals and levels, never a verdict.',
    '',
    '## Employer Verification',
    '',
    '- Website reachable:',
    '- Domain match:',
    '- Contact channel:',
    '- Notes:',
    '',
    '## Recommended Actions',
    '',
    hardStops.length
      ? hardStops.map((item, index) => `${index + 1}. **Stop:** ${item}`).join('\n')
      : '1.',
    '',
    '## Risk Summary',
    '',
    '| Signal | Value |',
    '|---|---|',
    '| Legitimacy | pass |',
    '| Classification | pass |',
    '| Culture | pass |',
    '| Interview red flags | pass |',
    '',
    '## Score Evidence',
    '',
    '| Dimension | Status | Observation | Open question |',
    '|---|---|---|---|',
    '| Legitimacy | supported | see Risk Assessment | |',
    '| Compensation signals | | | |',
    '',
    '## Job Description (archived verbatim)',
    '',
    '> Copy the full job description verbatim here, or place a matching `jds/`',
    '> capture file and reference it.',
    '',
  ].join('\n');
}

export function formatReportName({ reportNum, company, title }) {
  return `${String(reportNum).padStart(3, '0')}-${slug(company || 'company')}-${slug(title || 'role')}.md`;
}

export function buildReport({ row, reportNum, indicatorInput, summary, env }) {
  const risk = assessRisk(indicatorInput);
  const doc = { ...summary };
  doc.legitimacy_tier = doc.legitimacy_tier ?? risk.legitimacyTier;
  doc.risk_level = doc.risk_level ?? risk.level;
  doc.confidence = doc.confidence ?? risk.confidence;
  doc.categories = doc.categories ?? risk.categories;
  doc.indicators = doc.indicators ?? risk.indicators;
  if (env?.verbose) console.error(`assessed ${doc.indicators.length} indicator(s) -> ${risk.level} / ${risk.legitimacyTier}`);
  const body = renderReport({ row, reportNum, risk, summary: doc });
  const machine = parseFirstSummary(body);
  const problems = validateMachineSummary(machine);
  return { reportNum, body, risk, machine, problems };
}

function parseFirstSummary(body) {
  const match = body.match(/<!-- machine-summary -->([\s\S]*?)<!-- \/machine-summary -->/);
  if (!match) return null;
  const yamlBlock = match[1].match(/```yaml\n([\s\S]*?)\n```/);
  if (!yamlBlock) return null;
  try {
    return yaml.load(yamlBlock[1]);
  } catch {
    return null;
  }
}

function main(argv) {
  const asJson = argv.includes('--json');
  const dryRun = argv.includes('--dry-run');
  const positionals = argv.filter((arg) => !arg.startsWith('--'));
  if (positionals.length < 1) return usage('a tracker selector is required');

  const selector = positionals[0];
  const indicators = flag(argv, '--indicators') ?? '';
  const finalDecision = flag(argv, '--final-decision') ?? '';
  const nextAction = flag(argv, '--next-action') ?? '';
  if (finalDecision && !FINAL_DECISIONS.includes(finalDecision)) {
    return usage(`--final-decision must be one of ${FINAL_DECISIONS.join(', ')}`);
  }

  const env = process.env;
  const dataRoot = resolveDataRoot(env);
  const trackerPath = resolveTrackerRead(env);
  const lockPath = path.join(dataRoot, 'data', '.tracker.lock');

  const respond = (payload, code) => {
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else if (payload.error) console.error(payload.error);
    else console.log(payload.message ?? '');
    return code;
  };

  if (!fs.existsSync(trackerPath)) return respond({ ok: false, error: `tracker not initialized: ${trackerPath}` }, 5);

  try {
    return withLock(lockPath, () => {
      const parsed = parseFindings(fs.readFileSync(trackerPath, 'utf8'));
      const candidates = parsed.rows.filter((row) => !row.malformed && /^\d+$/.test(String(row.num ?? '')));
      const digits = /^\d+$/.test(selector);
      const matches = digits
        ? candidates.filter((row) => row.num === selector)
        : candidates.filter((row) => row.title.toLowerCase().includes(selector.toLowerCase()));
      if (matches.length === 0) return respond({ ok: false, error: `no row matches "${selector}"` }, 3);
      if (matches.length > 1) {
        const list = matches.map((row) => `${row.num}: ${row.title}`).join('\n  ');
        return respond({ ok: false, error: `ambiguous selector "${selector}":\n  ${list}` }, 3);
      }
      const row = matches[0];
      const reportNum = Math.max(...collectNumbers(dataRoot, env, trackerPath)) + 1;

      const summary = {};
      if (finalDecision) summary.final_decision = finalDecision;
      if (nextAction) summary.next_action = nextAction;

      const result = buildReport({ row, reportNum, indicatorInput: indicators, summary, env });
      const reportName = formatReportName({ reportNum, company: row.company, title: row.title });
      const reportPath = path.join(dataRoot, 'reports', reportName);
      if (!dryRun) {
        atomicWrite(reportPath, result.body);
      }
      return respond(
        {
          ok: result.problems.length === 0,
          num: row.num,
          report: reportNum,
          title: row.title,
          company: row.company,
          risk: result.risk.level,
          legitimacy: result.risk.legitimacyTier,
          categories: result.risk.categories,
          indicators: result.risk.indicators.map((indicator) => indicator.code),
          dryRun,
          path: reportPath,
          problems: result.problems,
          message: `${dryRun ? 'would write' : 'wrote'} report ${reportNum} for row ${row.num} (risk: ${result.risk.level})`,
        },
        result.problems.length ? 1 : 0,
      );
    });
  } catch (error) {
    if (error instanceof TrackerError) return respond({ ok: false, error: error.message }, 6);
    throw error;
  }
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));