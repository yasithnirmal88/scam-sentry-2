import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {
  installDnsCache,
  uninstallDnsCache,
  flushDnsCache,
  cachedDnsEntries,
  isDnsCacheInstalled,
} from '../providers/_dns-cache.mjs';

test('install and uninstall restore the original lookup primitives', () => {
  flushDnsCache();
  uninstallDnsCache();
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  try {
    installDnsCache({ ttlMs: 60_000 });
    assert.equal(isDnsCacheInstalled(), true);
    assert.notEqual(dns.lookup, originalLookup);
    assert.notEqual(dns.promises.lookup, originalPromiseLookup);
    uninstallDnsCache();
    assert.equal(isDnsCacheInstalled(), false);
  } finally {
    uninstallDnsCache();
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromiseLookup;
  }
});

test('promise lookups are served from cache without a second resolution', async () => {
  flushDnsCache();
  uninstallDnsCache();
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  let resolves = 0;
  try {
    dns.promises.lookup = async () => {
      resolves += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    };
    dns.lookup = (host, options, callback) => callback(null, { address: 'x', family: 4 });
    installDnsCache({ ttlMs: 60_000 });
    const first = await dns.promises.lookup('example.test', { all: true });
    const second = await dns.promises.lookup('example.test', { all: true });
    assert.deepEqual(first, second);
    assert.equal(resolves, 1);
    assert.equal(cachedDnsEntries().length, 1);
  } finally {
    uninstallDnsCache();
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromiseLookup;
  }
});

test('empty resolution results are not cached', async () => {
  flushDnsCache();
  uninstallDnsCache();
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  let resolves = 0;
  try {
    dns.promises.lookup = async () => {
      resolves += 1;
      return [];
    };
    dns.lookup = (host, options, callback) => callback(null, null);
    installDnsCache({ ttlMs: 60_000 });
    await dns.promises.lookup('void.test', { all: true });
    await dns.promises.lookup('void.test', { all: true });
    assert.equal(resolves, 2);
    assert.equal(cachedDnsEntries().length, 0);
  } finally {
    uninstallDnsCache();
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromiseLookup;
  }
});

test('flushDnsCache empties the entry table', async () => {
  flushDnsCache();
  uninstallDnsCache();
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  try {
    dns.promises.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    dns.lookup = (host, options, callback) => callback(null, { address: 'x', family: 4 });
    installDnsCache({ ttlMs: 60_000 });
    await dns.promises.lookup('flush.test', { all: true });
    assert.equal(cachedDnsEntries().length, 1);
    flushDnsCache();
    assert.equal(cachedDnsEntries().length, 0);
  } finally {
    uninstallDnsCache();
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromiseLookup;
  }
});