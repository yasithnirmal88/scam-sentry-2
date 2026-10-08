import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGuard, isBlockedAddress, GuardError } from '../providers/_ip-guard.mjs';
import {
  parseRetryAfterMs,
  isRefusedRedirectError,
  isRetryableError,
  makeHttpCtx,
} from '../providers/_http.mjs';

test('isBlockedAddress blocks private, loopback, link-local and metadata ranges', () => {
  for (const address of [
    '0.0.0.0',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.9.9',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '198.18.0.9',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'ff02::1',
    '2001:0db8::1',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ['93.184.216.34', '1.1.1.1', '8.8.8.8', 'not-an-ip']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('makeGuard blocks hosts that resolve into private space', async () => {
  const guard = makeGuard({ lookup: async () => ['127.0.0.1'] });
  await assert.rejects(() => guard.assertUrl('http://internal.example/x'), GuardError);
  const pass = makeGuard({ lookup: async () => ['93.184.216.34'] });
  await pass.assertUrl('https://public.example/x');
});

test('assertUrl rejects non-http schemes and unresolvable hosts', async () => {
  const guard = makeGuard({ lookup: async () => [] });
  await assert.rejects(() => guard.assertUrl('ftp://example.com/x'), GuardError);
  await assert.rejects(() => guard.assertUrl('https://nowhere.example/x'), GuardError);
});

test('guard blocks before any network call is made', async () => {
  let calls = 0;
  const ctx = makeHttpCtx(makeGuard({ lookup: async () => ['10.0.0.1'] }), {
    fetchImpl: async () => {
      calls += 1;
      throw new Error('should never run');
    },
  });
  await assert.rejects(() => ctx.fetchText('http://internal.example/x'), GuardError);
  assert.equal(calls, 0);
});

test('parseRetryAfterMs parses seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs(' 5 '), 5000);
  const future = parseRetryAfterMs('2030-01-01T00:00:00Z');
  assert.ok(Number.isFinite(future) && future > 0);
  assert.equal(parseRetryAfterMs('garbage'), null);
  assert.equal(parseRetryAfterMs(''), null);
});

test('error classifiers behave', () => {
  assert.equal(isRefusedRedirectError(new Error('redirect mode is set to error (use manual)')), true);
  assert.equal(isRefusedRedirectError(new Error('redirection refused')), true);
  assert.equal(isRefusedRedirectError(new Error('wat')), false);

  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(isRetryableError(abort), true);
  assert.equal(isRetryableError({ code: 'ENOTFOUND' }), true);
  assert.equal(isRetryableError(new Error('getaddrinfo ENOTFOUND example.com')), true);
  assert.equal(isRetryableError(new Error('redirect mode is set to error')), false);
  assert.equal(isRetryableError(new GuardError('blocked')), false);
});

test('fetchText throws on non-ok response', async () => {
  const ctx = makeHttpCtx(makeGuard({ lookup: async () => ['93.184.216.34'] }), {
    fetchImpl: async () => ({ ok: false, status: 404, url: 'https://public.example/x', text: async () => 'nope' }),
  });
  await assert.rejects(() => ctx.fetchText('https://public.example/x'), /http 404/);
});

test('fetchResponseWithRetry retries 429 without sleeping when waitMs=0', async () => {
  let count = 0;
  const ctx = makeHttpCtx(makeGuard({ lookup: async () => ['93.184.216.34'] }), {
    fetchImpl: async () => {
      count += 1;
      if (count === 1) return { status: 429, ok: false, headers: { get: () => '0' } };
      return { status: 200, ok: true, headers: { get: () => null } };
    },
  });
  const response = await ctx.fetchResponseWithRetry('https://public.example/x', { redirect: 'error', waitMs: 0, retries: 2 });
  assert.equal(response.status, 200);
  assert.equal(count, 2);
});

test('fetchResponseWithRetry never retries a refused redirect', async () => {
  const ctx = makeHttpCtx(makeGuard({ lookup: async () => ['93.184.216.34'] }), {
    fetchImpl: async () => {
      throw new Error('redirect mode is set to error (use manual)');
    },
  });
  await assert.rejects(
    () => ctx.fetchResponseWithRetry('https://public.example/x', { redirect: 'error', waitMs: 0, retries: 5 }),
    /redirect mode/,
  );
});