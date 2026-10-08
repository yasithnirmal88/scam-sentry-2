#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot } from './lib/paths.mjs';
import { walkFiles } from './lib/files.mjs';

export const JD_ARCHIVE_MARKER = '## Job Description (archived verbatim)';

function hasVerbatimSection(text) {
  return String(text ?? '').includes(JD_ARCHIVE_MARKER);
}

function captureReference(text) {
  const match = String(text ?? '').match(/(?:jds\/)?[\w.-]+\.(?:md|txt|pdf)/i);
  return match ? match[0] : null;
}

export function checkReportArchive(text, opts = {}) {
  const problems = [];
  let verbatim = hasVerbatimSection(text);
  let capture = null;
  if (!verbatim) {
    capture = captureReference(text);
    if (!capture) {
      problems.push('report has neither a verbatim JD section nor a jds/ capture reference');
      return { ok: false, problems, verbatim: false, capture: null };
    }
    const jdsDir = opts.jdsDir ?? '';
    if (jdsDir) {
      const target = capture.startsWith('jds/') ? capture.slice(4) : capture;
      if (!fs.existsSync(path.join(jdsDir, target))) {
        problems.push(`referenced capture file is missing: ${capture}`);
      }
    }
  }
  return { ok: problems.length === 0, problems, verbatim, capture };
}

export function runArchiveChecks(opts = {}) {
  const env = opts.env ?? process.env;
  const dataRoot = resolveDataRoot(env);
  const jdsDir = path.join(dataRoot, 'jds');
  const reportsDir = path.join(dataRoot, 'reports');
  const files = fs.existsSync(reportsDir) ? walkFiles(reportsDir, { ext: '.md' }) : [];
  const reports = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const result = checkReportArchive(text, { jdsDir: fs.existsSync(jdsDir) ? jdsDir : '' });
    reports.push({ file, ...result });
  }
  const bad = reports.filter((report) => !report.ok);
  return { reports, bad, ok: bad.length === 0 };
}

function main(argv) {
  const asJson = argv.includes('--json');
  const summaryOnly = argv.includes('--summary');
  const report = runArchiveChecks();
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  if (summaryOnly) {
    console.log(`reports=${report.reports.length} missing=${report.bad.length}`);
    return report.ok ? 0 : 1;
  }
  console.log(`check-jd-archive: ${report.reports.length} report(s)`);
  for (const item of report.reports) {
    const mark = item.ok ? 'ok  ' : 'FAIL';
    console.log(` ${mark} ${path.basename(item.file)}`);
    for (const message of item.problems) console.log(`      ${message}`);
  }
  console.log(`summary: ${report.bad.length} report(s) missing an archived JD`);
  return report.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));