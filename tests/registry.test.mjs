import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  providerFiles,
  isProviderFile,
  listProviders,
  specById,
  specsForUrl,
  resolveProvider,
  clearProviderCache,
} from '../providers/_registry.mjs';

const STUB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-providers');

function writeTempProvider(dir, id, host) {
  const file = path.join(dir, `${id}.mjs`);
  fs.writeFileSync(
    file,
    `export default {\n  id: '${id}',\n  hosts: ['${host}'],\n  keyword: (url) => String(url).includes('${host}'),\n  detect: () => null,\n  async fetch() { return []; },\n};\n`,
    'utf8',
  );
  return file;
}

test('isProviderFile skips underscore shared modules', () => {
  assert.equal(isProviderFile('_http.mjs'), false);
  assert.equal(isProviderFile('_registry.mjs'), false);
  assert.equal(isProviderFile('greenhouse.mjs'), true);
});

test('providerFiles lists only provider modules in a direction', () => {
  const files = providerFiles({ dir: STUB_DIR });
  assert.deepEqual(files.map((file) => path.basename(file)), ['stubboard.mjs']);
});

test('listProviders returns id and file for the stub provider', async () => {
  clearProviderCache();
  const specs = await listProviders({ dir: STUB_DIR });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].spec.id, 'stubboard');
});

test('specById matches case-insensitively', async () => {
  const found = await specById('StubBoard', { dir: STUB_DIR });
  assert.ok(found);
  assert.equal(found.spec.id, 'stubboard');
  assert.equal(await specById('nope', { dir: STUB_DIR }), null);
});

test('specsForUrl matches by keyword and hosts', async () => {
  const byKeyword = await specsForUrl('https://stub.example/board', { dir: STUB_DIR });
  assert.equal(byKeyword.length, 1);
  assert.equal(byKeyword[0].spec.id, 'stubboard');
});

test('resolveProvider prefers integration over url matching', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-reg-'));
  try {
    writeTempProvider(root, 'alpha', 'alpha.example');
    writeTempProvider(root, 'beta', 'beta.example');
    const opts = { dir: root };
    const byId = await resolveProvider({ integration: 'beta', url: 'https://alpha.example/x' }, opts);
    assert.equal(byId.spec.id, 'beta');
    const byUrl = await resolveProvider({ url: 'https://alpha.example/x' }, opts);
    assert.equal(byUrl.spec.id, 'alpha');
    assert.equal(await resolveProvider({ url: 'https://nowhere.example/x' }, opts), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});