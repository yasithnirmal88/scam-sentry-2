import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from '../scan.mjs';
import { tempRoot, envFor, writePortals } from './fixtures.mjs';

const STUB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-providers');

function env(root) {
  return { ...envFor(root), SCAM_SENTRY_PROVIDERS_DIR: STUB_DIR, SCAM_SENTRY_DNS_CACHE: '0' };
}

function portals(root) {
  return writePortals(
    root,
    [
      {
        name: 'Filtered',
        url: 'https://stub.example/filter',
        source: 'stub',
        filters: { title_blacklist: ['suspicious'] },
      },
      { name: 'Stub', url: 'https://stub.example/board', source: 'stub' },
    ],
    'portals.yml',
  );
}

test('runScan filters, dedups and writes additions, history and runs', async () => {
  const root = tempRoot();
  portals(root);
  const report = await runScan({ env: env(root) });
  assert.equal(report.ok, true);
  assert.equal(report.counts.postings, 6);
  assert.equal(report.counts.added, 2);
  assert.equal(report.counts.skipped_title, 1);
  assert.equal(report.counts.duplicate, 3);

  const additionsDir = path.join(root, 'data', 'additions');
  assert.equal(fs.readdirSync(additionsDir).length, 2);

  const historyLines = fs.readFileSync(path.join(root, 'data', 'scan-history.tsv'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(historyLines.length, 7); // header + 6 rows
  assert.ok(historyLines[1].includes('\tadded\t'));

  const runsLines = fs.readFileSync(path.join(root, 'data', 'scan-runs.tsv'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(runsLines.length, 2); // header + one row
  assert.ok(runsLines[1].includes('\t2\t6\t2\t4'));

  for (const name of fs.readdirSync(additionsDir)) {
    const body = fs.readFileSync(path.join(additionsDir, name), 'utf8');
    assert.ok(body.includes('Queued'), name);
    assert.ok(!body.includes('suspicious'), name);
  }
});

test('runScan second pass treats everything as duplicate', async () => {
  const root = tempRoot();
  portals(root);
  await runScan({ env: env(root) });
  const second = await runScan({ env: env(root) });
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.duplicate, 6);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'additions')).length, 2);
  const history = fs.readFileSync(path.join(root, 'data', 'scan-history.tsv'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(history.length, 13); // header + 12 rows
});

test('runScan --dry-run writes nothing', async () => {
  const root = tempRoot();
  portals(root);
  const report = await runScan({ env: env(root), dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.counts.added, 2);
  assert.equal(fs.existsSync(path.join(root, 'data', 'additions')), false);
  assert.equal(fs.existsSync(path.join(root, 'data', 'scan-history.tsv')), false);
  assert.equal(fs.existsSync(path.join(root, 'data', 'scan-runs.tsv')), false);
});

test('runScan honors limit', async () => {
  const root = tempRoot();
  portals(root);
  const report = await runScan({ env: env(root), limit: 2 });
  assert.equal(report.counts.added, 2);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'additions')).length, 2);
});

test('runScan records no-provider and dedups within a run', async () => {
  const root = tempRoot();
  writePortals(root, [{ name: 'Unroutable', url: 'https://nobody.example/x', source: 'ghost' }], 'portals.yml');
  const report = await runScan({ env: env(root) });
  assert.equal(report.counts.no_provider, 1);
  assert.equal(report.counts.error, 0);
  assert.equal(report.ok, true);
});

test('runScan takes over existing reservation numbers', async () => {
  const root = tempRoot();
  portals(root);
  fs.mkdirSync(path.join(root, 'data', 'additions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'data', 'additions', '042-existing.tsv'),
    'num\tdate\ttitle\tsource\tcompany\turl\trisk\tconfidence\tstatus\treport\tcompany2\tlocation\tnotes\n',
    'utf8',
  );
  const report = await runScan({ env: env(root) });
  assert.equal(report.nextNum, 43);
  const names = fs.readdirSync(path.join(root, 'data', 'additions'));
  assert.ok(names.some((name) => /^0?43-/.test(name)), names.join(','));
});

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}