import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderFindings, STATUS_LOG_HEADER } from '../lib/tracker.mjs';

export function tempRoot(prefix = 'ss-fix-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function baseRow(overrides = {}) {
  return {
    malformed: false,
    num: '1',
    date: '2026-10-08',
    title: 'Senior Engineer',
    source: 'greenhouse',
    company: 'ACME',
    location: 'Remote',
    url: 'https://jobs.example.com/posting/1',
    risk: '—',
    confidence: '—',
    status: 'Queued',
    report: '—',
    notes: '',
    ...overrides,
  };
}

export function writeTracker(root, rows) {
  const file = path.join(root, 'data', 'findings.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderFindings(rows.map((row) => ({ ...baseRow(), ...row }))), 'utf8');
  return file;
}

export function writeTrackerRaw(root, content) {
  const file = path.join(root, 'data', 'findings.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

export function writeReport(root, name, body = '# Analysis\n') {
  const dir = path.join(root, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

export function writeAddition(root, name, labels, cells) {
  const dir = path.join(root, 'data', 'additions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${labels.join('\t')}\n${cells.join('\t')}\n`, 'utf8');
  return file;
}

export function writeStatusLog(root, rows, header = STATUS_LOG_HEADER) {
  const file = path.join(root, 'data', 'status-log.tsv');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = rows.map((row) =>
    [row.timestamp, row.prev, row.next, row.source, row.num, row.note ?? ''].join('\t'),
  );
  fs.writeFileSync(file, [header.join('\t'), ...lines, ''].join('\n'), 'utf8');
  return file;
}

export function writeReservations(root, rows) {
  const file = path.join(root, 'data', 'report-nums.reserved.tsv');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = rows.map((row) => [row.start, row.end, row.timestamp].join('\t'));
  fs.writeFileSync(file, ['start\tend\ttimestamp', ...lines, ''].join('\n'), 'utf8');
  return file;
}

export function envFor(root) {
  return { SCAM_SENTRY_ROOT: root };
}
