import fs from 'node:fs';
import path from 'node:path';
import { isSentinel, resolveEnum, resolveState } from './states.mjs';

export class TrackerError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'TrackerError';
    this.errors = errors.length ? errors : [message];
  }
}

export const COLUMNS = [
  { key: 'num', label: '#' },
  { key: 'date', label: 'Date' },
  { key: 'title', label: 'Title' },
  { key: 'source', label: 'Source' },
  { key: 'company', label: 'Company' },
  { key: 'location', label: 'Location' },
  { key: 'url', label: 'URL' },
  { key: 'risk', label: 'Risk' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'status', label: 'Status' },
  { key: 'report', label: 'Report' },
  { key: 'notes', label: 'Notes' },
];

export const COLUMN_KEYS = COLUMNS.map((column) => column.key);
export const LABEL_TO_KEY = new Map(COLUMNS.map((column) => [column.label.toLowerCase(), column.key]));
export const REQUIRED_TSV_LABELS = ['num', 'date', 'title', 'source', 'url', 'risk', 'confidence', 'status', 'report'];
export const OPTIONAL_TSV_LABELS = ['company', 'location', 'notes'];
export const ALLOWED_TSV_LABELS = [...REQUIRED_TSV_LABELS, ...OPTIONAL_TSV_LABELS];
export const VALID_SOURCES = ['cli', 'agent', 'merge', 'script', 'import'];
export const STATUS_LOG_HEADER = ['timestamp', 'prev', 'new', 'source', 'num', 'note'];

export const SENTINEL_DISPLAY = '—';
export const REPORT_LINK_RE = /^\[(\d+)\]\((.+)\)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^[a-z0-9][a-z0-9-]*$/;
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|igshid|mc_cid|mc_eid|referrer$)/;

export function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function unescapeCell(value) {
  return String(value ?? '').replace(/\\\|/g, '|').trim();
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const parts = [];
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function isSeparatorLine(line) {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

export function parseFindings(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const tableLines = [];
  for (const line of lines) {
    if (line.trim().startsWith('|')) tableLines.push(line);
  }
  if (tableLines.length === 0) return { headerKeys: [], rows: [], empty: true };

  const headerKeys = splitRow(tableLines[0]).map((label) => LABEL_TO_KEY.get(label.toLowerCase()) ?? null);
  const rows = [];
  let sawSeparator = false;
  for (const line of tableLines.slice(1)) {
    if (!sawSeparator && isSeparatorLine(line)) {
      sawSeparator = true;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length !== headerKeys.length || headerKeys.some((key) => key === null)) {
      rows.push({ malformed: true, cells, raw: line });
      continue;
    }
    const row = { malformed: false, raw: line };
    headerKeys.forEach((key, index) => {
      row[key] = cells[index];
    });
    rows.push(row);
  }
  return { headerKeys, rows, empty: false };
}

export function renderFindings(rows) {
  const header = `| ${COLUMNS.map((column) => column.label).join(' | ')} |`;
  const divider = `| ${COLUMNS.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    if (row.malformed) return row.raw ?? `| ${row.cells.join(' | ')} |`;
    return `| ${COLUMNS.map((column) => escapeCell(row[column.key])).join(' | ')} |`;
  });
  return [
    '# Findings',
    '',
    'Canonical tracker. Rows are written by `merge-tracker.mjs` (pending',
    'additions from `data/additions/`) and status cells by',
    '`set-status.mjs` — do not edit rows by hand.',
    '',
    header,
    divider,
    ...body,
    '',
  ].join('\n');
}

export function parseAddition(text) {
  const errors = [];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { labels: [], row: null, errors: ['addition file is empty'] };
  }
  if (lines.length !== 2) {
    errors.push(`expected a header row and exactly one data row, found ${lines.length} non-empty lines`);
    return { labels: [], row: null, errors };
  }
  const labels = lines[0].split('\t').map((label) => label.trim().toLowerCase());
  const seen = new Set();
  for (const label of labels) {
    if (seen.has(label)) errors.push(`duplicate label: ${label}`);
    seen.add(label);
    if (!COLUMN_KEYS.includes(label)) errors.push(`unknown label: ${label}`);
  }
  for (const required of REQUIRED_TSV_LABELS) {
    if (!seen.has(required)) errors.push(`missing required label: ${required}`);
  }
  const cells = lines[1].split('\t');
  if (cells.length !== labels.length) {
    errors.push(`header has ${labels.length} labels but the data row has ${cells.length} cells`);
    return { labels, row: null, errors };
  }
  const row = { malformed: false };
  labels.forEach((label, index) => {
    if (COLUMN_KEYS.includes(label)) row[label] = cells[index].trim();
  });
  return { labels, row, errors };
}

export function validateRow(row, catalog) {
  const errors = [];
  const num = String(row.num ?? '').trim();
  if (!/^\d+$/.test(num) || Number(num) < 1) errors.push(`num must be a positive integer, got "${num}"`);

  const date = String(row.date ?? '').trim();
  if (!ISO_DATE_RE.test(date)) errors.push(`date must be YYYY-MM-DD, got "${date}"`);

  if (!String(row.title ?? '').trim()) errors.push('title is empty');
  const source = String(row.source ?? '').trim();
  if (!SOURCE_RE.test(source)) errors.push(`source must be a lowercase slug, got "${source}"`);

  const url = String(row.url ?? '').trim();
  if (!isSentinel(catalog, url) && !/^https?:\/\//i.test(url)) {
    errors.push(`url must be http(s) or a sentinel, got "${url}"`);
  }

  const risk = String(row.risk ?? '').trim();
  if (!isSentinel(catalog, risk) && !resolveEnum(catalog.riskLevels, risk)) {
    errors.push(`risk must be one of ${catalog.riskLevels.join('/')} or a sentinel, got "${risk}"`);
  }

  const confidence = String(row.confidence ?? '').trim();
  if (!isSentinel(catalog, confidence) && !resolveEnum(catalog.confidenceLevels, confidence)) {
    errors.push(`confidence must be one of ${catalog.confidenceLevels.join('/')} or a sentinel, got "${confidence}"`);
  }

  const status = String(row.status ?? '').trim();
  if (!resolveState(catalog, status)) {
    errors.push(`status "${status}" is not a canonical state or alias`);
  }

  const report = String(row.report ?? '').trim();
  if (!isSentinel(catalog, report) && !REPORT_LINK_RE.test(report) && !/^[A-Za-z0-9._/-]+\.md$/.test(report)) {
    errors.push(`report must be a sentinel, a [n](path) link, or a .md path, got "${report}"`);
  }

  return errors;
}

export function canonicalizeRow(row, catalog) {
  const out = { ...row, malformed: false };
  out.num = String(row.num ?? '').trim();
  out.date = String(row.date ?? '').trim();
  out.title = String(row.title ?? '').trim();
  out.source = String(row.source ?? '').trim().toLowerCase();
  const risk = resolveEnum(catalog.riskLevels, String(row.risk ?? ''));
  const confidence = resolveEnum(catalog.confidenceLevels, String(row.confidence ?? ''));
  const status = resolveState(catalog, String(row.status ?? ''));
  out.risk = risk ?? (isSentinel(catalog, row.risk) ? SENTINEL_DISPLAY : String(row.risk ?? '').trim());
  out.confidence = confidence ?? (isSentinel(catalog, row.confidence) ? SENTINEL_DISPLAY : String(row.confidence ?? '').trim());
  out.status = status ?? String(row.status ?? '').trim();
  for (const key of ['company', 'location', 'url', 'report', 'notes']) {
    out[key] = String(row[key] ?? '').trim();
  }
  if (isSentinel(catalog, out.risk)) out.risk = SENTINEL_DISPLAY;
  if (isSentinel(catalog, out.confidence)) out.confidence = SENTINEL_DISPLAY;
  if (isSentinel(catalog, out.report)) out.report = SENTINEL_DISPLAY;
  if (isSentinel(catalog, out.url)) out.url = SENTINEL_DISPLAY;
  return out;
}

const TRACKING_NOISE = new Set(['fbclid', 'gclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'referrer']);

export function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return raw.toLowerCase();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.toLowerCase();
  }
  const params = [];
  for (const [key, val] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.test(lower) || TRACKING_NOISE.has(lower)) continue;
    params.push([key, val]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hashMatch = parsed.hash.match(/^#\/jobs?\/([A-Za-z0-9-]+)/);
  parsed.hash = '';
  parsed.search = '';
  for (const [key, val] of params) parsed.searchParams.append(key, val);
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  let href = parsed.href;
  if (hashMatch) href = `${href.replace(/\/$/, '')}/#/job/${hashMatch[1]}`;
  return href;
}

export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function dedupKey(row) {
  const url = normalizeUrl(row.url);
  if (url && !/^—$|^-$/i.test(url) && /^https?:\/\//i.test(url)) return `url:${url}`;
  return `title:${slug(row.title)}|src:${slug(row.source)}`;
}

export function reportTarget(cell) {
  const value = String(cell ?? '').trim();
  const match = value.match(REPORT_LINK_RE);
  if (match) return match[2];
  if (/^[A-Za-z0-9._/-]+\.md$/.test(value)) return value;
  return null;
}

export function rewriteReportLink(cell, { root, trackerDir }) {
  const value = String(cell ?? '').trim();
  if (value === SENTINEL_DISPLAY) return value;
  const target = reportTarget(value);
  if (!target) return value;
  const linkNumber = (value.match(REPORT_LINK_RE) ?? [null, null])[1] ?? '';
  const fromRoot = path.resolve(root, target);
  const fromTracker = path.resolve(trackerDir, target);
  let absolute = null;
  if (fs.existsSync(fromTracker)) absolute = fromTracker;
  else if (fs.existsSync(fromRoot)) absolute = fromRoot;
  else return value;
  const rel = path.relative(trackerDir, absolute).split(path.sep).join('/');
  return linkNumber ? `[${linkNumber}](${rel})` : rel;
}

export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

export function withLock(lockFile, fn, opts = {}) {
  const staleMs = opts.staleMs ?? 30000;
  const attempts = opts.attempts ?? 10;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  let acquired = false;
  for (let i = 0; i < attempts && !acquired; i += 1) {
    try {
      fs.writeFileSync(lockFile, payload, { flag: 'wx' });
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = Infinity;
      try {
        age = Date.now() - fs.statSync(lockFile).mtimeMs;
      } catch {
        age = Infinity;
      }
      if (age > staleMs) {
        try {
          fs.unlinkSync(lockFile);
        } catch {
          /* raced with another reaper */
        }
        continue;
      }
      const until = Date.now() + 25;
      while (Date.now() < until) {
        /* small synchronous backoff */
      }
    }
  }
  if (!acquired) throw new TrackerError(`tracker is locked by another process (${lockFile})`);
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* already released */
    }
  }
}

export function formatNum(num) {
  return String(num).padStart(3, '0');
}

export function parseNumLabel(label) {
  const match = String(label ?? '').trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2] ?? match[1]) };
}
