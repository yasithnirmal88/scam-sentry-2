import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePortals } from '../validate-portals.mjs';
import { verifyPortals } from '../verify-portals.mjs';
import { checkProviders, violationsForSource } from '../scripts/check-providers.mjs';
import { tempRoot, envFor, writePortals } from './fixtures.mjs';

const STUB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-providers');

function env(root) {
  return { ...envFor(root), SCAM_SENTRY_PROVIDERS_DIR: STUB_DIR };
}

test('validate-portals accepts a resolvable entry', async () => {
  const root = tempRoot();
  writePortals(root, [{ name: 'Stub', url: 'https://stub.example/board', source: 'stub' }], 'portals.yml');
  const report = await validatePortals({ env: env(root) });
  assert.equal(report.valid, true);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].resolved, 'stubboard');
});

test('validate-portals flags unknown keys and unroutable entries', async () => {
  const root = tempRoot();
  writePortals(
    root,
    [
      { name: 'Bad', url: 'https://nobody.example/x', source: 'ghost', mystery: true },
      { name: 'NoName' },
    ],
    'portals.yml',
  );
  const report = await validatePortals({ env: env(root) });
  assert.equal(report.valid, false);
  const all = report.problems.join('\n');
  assert.ok(all.includes('unknown key'), all);
  assert.ok(all.includes('no provider'), all);
});

test('validate-portals lets integration win over url', async () => {
  const root = tempRoot();
  writePortals(root, [{ name: 'Direct', integration: 'stubboard', url: 'https://nobody.example/x' }], 'portals.yml');
  const report = await validatePortals({ env: env(root) });
  assert.equal(report.valid, true);
  assert.equal(report.entries[0].resolved, 'stubboard');
});

test('verify-portals static reports missing providers', async () => {
  const root = tempRoot();
  writePortals(
    root,
    [
      { name: 'Good', url: 'https://stub.example/board' },
      { name: 'Ghost', url: 'https://nobody.example/x' },
    ],
    'portals.yml',
  );
  const report = await verifyPortals({ env: env(root) });
  assert.equal(report.ok, false);
  assert.equal(report.noProvider.length, 1);
  assert.equal(report.noProvider[0].name, 'Ghost');
});

test('check-providers: real provider dir is clean', async () => {
  const report = await checkProviders({});
  assert.equal(report.ok, true, report.problems.join('\n'));
  assert.equal(report.files, 23);
});

test('violationsForSource catches direct fetch and _http imports', () => {
  assert.ok(violationsForSource('const r = await fetch(url, { redirect: "error" });').some((text) => text.includes('global fetch')));
  assert.ok(violationsForSource("import { fetchJson } from './_http.mjs';").some((text) => text.includes('_http.mjs')));
  assert.ok(violationsForSource('return https.get(url);').some((text) => text.includes('http.get')));
  assert.deepEqual(violationsForSource('export default { fetch(ctx) { return ctx.fetchJson(u, { redirect: "error" }); } };'), []);
});