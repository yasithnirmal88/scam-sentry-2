import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProviders } from '../providers/_registry.mjs';
import { hostMatchesSuffix } from '../providers/_util.mjs';

const PROVIDERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'providers');

function recorder(responder) {
  const calls = [];
  const call = (url, request) => {
    calls.push({ url, request });
    return responder(url, request);
  };
  const ctx = {
    fetchResponse: call,
    fetchResponseWithRetry: call,
    fetchText: (url, request) => {
      const value = call(url, request);
      return value && typeof value.text === 'function' ? value.text() : Promise.resolve(String(value ?? ''));
    },
    fetchTextWithRetry: (url, request) => {
      const value = call(url, request);
      return value && typeof value.text === 'function' ? value.text() : Promise.resolve(String(value ?? ''));
    },
    fetchJson: (url, request) => Promise.resolve(call(url, request)),
    fetchJsonWithRetry: (url, request) => Promise.resolve(call(url, request)),
    sleep: async () => {},
    maxPages: 1,
    timeoutMs: 10000,
  };
  return { ctx, calls };
}

test('provider contract: 19 providers, ids match filenames', async () => {
  const specs = await listProviders();
  assert.equal(specs.length, 19);
  const ids = specs.map((entry) => entry.spec.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  for (const { file, spec } of specs) {
    assert.equal(spec.id, path.basename(file).replace(/\.mjs$/, ''), `id for ${path.basename(file)}`);
  }
});

test('provider contract: hosts or keyword present, detect yields https urls', async () => {
  const specs = await listProviders();
  for (const { spec } of specs) {
    const hasHosts = Array.isArray(spec.hosts);
    const hasKeyword = typeof spec.keyword === 'function';
    assert.ok(hasHosts || hasKeyword, `${spec.id}: hosts or keyword`);
    const probe = spec.detect({});
    if (probe === null || probe === undefined) continue;
    assert.equal(typeof probe.url, 'string', `${spec.id}: detect url`);
    assert.ok(/^https:\/\//.test(probe.url), `${spec.id}: https seed url, got ${probe.url}`);
  }
});

test('provider contract: fetch survives malformed payloads', async () => {
  const specs = await listProviders();
  const entry = {
    name: 'Contract test',
    url: 'https://stub.example/x',
    company: 'acme',
    board: 'acme',
    key: 'acme',
    endpoint: 'search',
  };
  for (const { spec } of specs) {
    for (const responder of [() => null, () => ({}), () => ({ jobs: [] })]) {
      const { ctx, calls } = recorder(responder);
      const out = await spec.fetch(entry, ctx);
      assert.ok(Array.isArray(out), `${spec.id}: fetch must return an array, got ${JSON.stringify(out).slice(0, 40)}`);
      assert.equal(out.length, 0, `${spec.id}: malformed payload should yield []`);
    }
  }
});

test('provider contract: every ctx call demands redirect:error', async () => {
  const specs = await listProviders();
  const entry = {
    name: 'Contract test',
    url: 'https://stub.example/x',
    company: 'acme',
    board: 'acme',
    key: 'acme',
    endpoint: 'search',
  };
  for (const { spec } of specs) {
    const { ctx, calls } = recorder(() => ({}));
    await spec.fetch(entry, ctx);
    assert.ok(calls.length > 0, `${spec.id}: expected at least one ctx call`);
    for (const call of calls) {
      assert.equal(call.request.redirect, 'error', `${spec.id}: fetch ${call.url} must ask redirect:error`);
    }
  }
});

test('dynamic providers enforce anchored host allowlists', async () => {
  const specs = await listProviders();
  const dynamic = specs.filter(({ spec }) => typeof spec.assertEntryAllowed === 'function');
  assert.equal(dynamic.length, 3);
  const allow = new Map([
    ['icims', ['https://acme.icims.com/jobs']],
    ['workday', ['https://acme.myworkdayjobs.com/board']],
    ['jobvite', ['https://jobs.acme.jobvite.com']],
  ]);
  for (const { spec } of dynamic) {
    for (const url of allow.get(spec.id)) {
      spec.assertEntryAllowed({ url });
    }
    assert.throws(() => spec.assertEntryAllowed({ url: 'https://evil.example/x' }), /anchored/, `${spec.id} must reject off-suffix hosts`);
    assert.throws(() => spec.assertEntryAllowed({ url: 'https://icims.com.evil.test/x' }), /anchored/, `${spec.id} must reject suffix tricks`);
  }
});

test('hostMatchesSuffix is anchored', () => {
  assert.equal(hostMatchesSuffix('https://acme.myworkdayjobs.com/board', ['myworkdayjobs.com']), true);
  assert.equal(hostMatchesSuffix('https://myworkdayjobs.com', ['myworkdayjobs.com']), true);
  assert.equal(hostMatchesSuffix('https://evil-myworkdayjobs.com', ['myworkdayjobs.com']), false);
  assert.equal(hostMatchesSuffix('https://myworkdayjobs.com.evil.test', ['myworkdayjobs.com']), false);
});