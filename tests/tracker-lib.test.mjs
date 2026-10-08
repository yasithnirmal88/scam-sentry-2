import fs from 'node:fs';
import path from 'node:path';
import { pass, fail } from './helpers.mjs';
import { tempRoot, baseRow, writeTracker, writeReport } from './fixtures.mjs';
import { loadStates } from '../lib/states.mjs';
import {
  COLUMNS,
  REQUIRED_TSV_LABELS,
  STATUS_LOG_HEADER,
  VALID_SOURCES,
  parseFindings,
  renderFindings,
  parseAddition,
  validateRow,
  canonicalizeRow,
  normalizeUrl,
  dedupKey,
  reportTarget,
  rewriteReportLink,
  formatNum,
  parseNumLabel,
  escapeCell,
  unescapeCell,
} from '../lib/tracker.mjs';

const check = (label, condition, detail = '') => {
  if (condition) pass(label);
  else fail(label, detail);
};

const catalog = loadStates();

const headerRow = `| ${COLUMNS.map((column) => column.label).join(' | ')} |`;
const dividerRow = `| ${COLUMNS.map(() => '---').join(' | ')} |`;

check('twelve display columns', COLUMNS.length === 12);
check('num column renders as #', COLUMNS[0].label === '#');
check('required tsv labels are declared', REQUIRED_TSV_LABELS.includes('report'));
check('status log schema has six fields', STATUS_LOG_HEADER.length === 6);
check('write sources are constrained', JSON.stringify(VALID_SOURCES) === JSON.stringify(['cli', 'agent', 'merge', 'script', 'import']));

const empty = parseFindings('');
check('empty text parses as empty', empty.empty === true && empty.rows.length === 0);

const roundtrip = parseFindings(renderFindings([baseRow(), baseRow({ num: '2', status: 'Analyzed' })]));
check('roundtrip keeps both rows', roundtrip.rows.length === 2, String(roundtrip.rows.length));
check('roundtrip keeps the num cell', roundtrip.rows[0]?.num === '1');
check('roundtrip keeps the status cell', roundtrip.rows[1]?.status === 'Analyzed');
check('roundtrip rows are well-formed', roundtrip.rows.every((row) => row.malformed === false));

const pipe = parseFindings(renderFindings([baseRow({ title: 'A | B' })]));
check('escaped pipes roundtrip in cells', pipe.rows[0]?.title === 'A | B', JSON.stringify(pipe.rows[0]?.title));
check('escapeCell escapes pipes', escapeCell('a|b') === 'a\\|b');
check('unescapeCell restores pipes', unescapeCell('a\\|b') === 'a|b');

const headerLabels = parseFindings(`${headerRow}\n${dividerRow}\n`).headerKeys;
check('hash header maps to num', headerLabels[0] === 'num');
check('report header maps to report', headerLabels[10] === 'report');

const malformed = parseFindings(`${headerRow}\n${dividerRow}\n| 1 | extra | cells |\n`);
check('wrong cell count marks the row malformed', malformed.rows[0]?.malformed === true);

const additionOk = parseAddition(
  `${REQUIRED_TSV_LABELS.join('\t')}\n${['7', '2026-10-08', 'Role', 'lever', 'https://x.example/7', 'Low', 'High', 'Queued', '—'].join('\t')}\n`,
);
check('valid addition parses without errors', additionOk.errors.length === 0, JSON.stringify(additionOk.errors));
check('addition row carries the num cell', additionOk.row?.num === '7');

const additionMissing = parseAddition(`num\tdate\ttitle\n1\t2026-10-08\tRole\n`);
check('missing required label is reported', additionMissing.errors.some((error) => error.includes('missing required label')));
const additionEmpty = parseAddition('   \n');
check('empty addition is reported', additionEmpty.errors.some((error) => error.includes('empty')));
const additionThree = parseAddition('a\nb\nc\n');
check('extra lines are reported', additionThree.errors.some((error) => error.includes('exactly one data row')));

const goodRow = baseRow();
check('valid row produces no errors', validateRow(goodRow, catalog).length === 0, JSON.stringify(validateRow(goodRow, catalog)));
check('bad num is reported', validateRow(baseRow({ num: '0' }), catalog).some((error) => error.includes('num')));
check('bad date is reported', validateRow(baseRow({ date: '10/08/2026' }), catalog).some((error) => error.includes('date')));
check('bad source is reported', validateRow(baseRow({ source: 'Green House' }), catalog).some((error) => error.includes('source')));
check('bad url is reported', validateRow(baseRow({ url: 'ftp://x' }), catalog).some((error) => error.includes('url')));
check('bad risk is reported', validateRow(baseRow({ risk: 'Extreme' }), catalog).some((error) => error.includes('risk')));
check('bad status is reported', validateRow(baseRow({ status: 'Weird' }), catalog).some((error) => error.includes('status')));
check('bad report is reported', validateRow(baseRow({ report: 'see notes' }), catalog).some((error) => error.includes('report')));

const canonical = canonicalizeRow(baseRow({ status: 'follow-up', risk: 'high', confidence: '', url: '' }), catalog);
check('alias status canonicalizes', canonical.status === 'Followup', canonical.status);
check('risk capitalizes canonically', canonical.risk === 'High', canonical.risk);
check('empty confidence becomes a sentinel', canonical.confidence === '—', canonical.confidence);
check('empty url becomes a sentinel', canonical.url === '—', canonical.url);
const canonicalMixed = canonicalizeRow(baseRow({ status: 'queued', risk: 'MEDIUM', confidence: 'high' }), catalog);
check('lowercase status canonicalizes', canonicalMixed.status === 'Queued', canonicalMixed.status);
check('mixed-case risk canonicalizes', canonicalMixed.risk === 'Medium', canonicalMixed.risk);
check('mixed-case confidence canonicalizes', canonicalMixed.confidence === 'High', canonicalMixed.confidence);

check('normalizeUrl lowercases the host', normalizeUrl('https://Example.COM/Path') === 'https://example.com/Path');
check(
  'normalizeUrl strips tracking params and sorts the rest',
  normalizeUrl('HTTPS://Example.COM/a/?b=2&utm_source=x&a=1') === 'https://example.com/a?a=1&b=2',
  normalizeUrl('HTTPS://Example.COM/a/?b=2&utm_source=x&a=1'),
);
check('normalizeUrl strips a trailing slash', normalizeUrl('https://example.com/jobs/') === 'https://example.com/jobs');
check(
  'normalizeUrl rewrites a job board hash',
  normalizeUrl('https://boards.example.com/jobs#/jobs/AbC-123') === 'https://boards.example.com/jobs/#/job/AbC-123',
  normalizeUrl('https://boards.example.com/jobs#/jobs/AbC-123'),
);
check('normalizeUrl passes through non-http text', normalizeUrl('See Notes') === 'see notes');

check('dedupKey prefers the normalized url', dedupKey(baseRow({ url: 'https://example.com/a/?utm_source=x' })) === 'url:https://example.com/a');
check(
  'dedupKey treats tracking variants as the same identity',
  dedupKey(baseRow({ url: 'https://example.com/a/' })) === dedupKey(baseRow({ url: 'https://EXAMPLE.com/a?fbclid=abc' })),
);
check(
  'dedupKey falls back to title and source when the url is a sentinel',
  dedupKey(baseRow({ url: '—' })) === 'title:senior-engineer|src:greenhouse',
  dedupKey(baseRow({ url: '—' })),
);

check('reportTarget extracts a link path', reportTarget('[3](../reports/003-x.md)') === '../reports/003-x.md');
check('reportTarget accepts a plain .md path', reportTarget('reports/003-x.md') === 'reports/003-x.md');
check('reportTarget rejects a sentinel', reportTarget('—') === null);
check('reportTarget rejects free text', reportTarget('see notes') === null);

const linkRoot = tempRoot();
writeReport(linkRoot, '003-x.md');
const trackerDir = path.join(linkRoot, 'data');
fs.mkdirSync(trackerDir, { recursive: true });
check(
  'rewriteReportLink resolves a root-relative link',
  rewriteReportLink('[3](reports/003-x.md)', { root: linkRoot, trackerDir }) === '[3](../reports/003-x.md)',
);
check(
  'rewriteReportLink leaves a resolved link alone',
  rewriteReportLink('[3](../reports/003-x.md)', { root: linkRoot, trackerDir }) === '[3](../reports/003-x.md)',
);
check(
  'rewriteReportLink leaves a missing target untouched',
  rewriteReportLink('[9](reports/009-missing.md)', { root: linkRoot, trackerDir }) === '[9](reports/009-missing.md)',
);
check('rewriteReportLink passes sentinels through', rewriteReportLink('—', { root: linkRoot, trackerDir }) === '—');

check('formatNum pads to three digits', formatNum(7) === '007');
check('formatNum accepts strings', formatNum('42') === '042');
check('parseNumLabel reads a single number', JSON.stringify(parseNumLabel('007')) === JSON.stringify({ start: 7, end: 7 }));
check('parseNumLabel reads a range', JSON.stringify(parseNumLabel('007-012')) === JSON.stringify({ start: 7, end: 12 }));
check('parseNumLabel rejects junk', parseNumLabel('abc') === null);

const fixture = tempRoot();
writeTracker(fixture, [baseRow()]);
const fileText = fs.readFileSync(path.join(fixture, 'data', 'findings.md'), 'utf8');
check('tracker file renders the display header', fileText.includes('| # | Date |'));
check('tracker file documents the writer scripts', fileText.includes('merge-tracker.mjs'));
check('rendered tracker has no forbidden vocabulary', !/[c][a][r][e][e][r]/i.test(fileText));
