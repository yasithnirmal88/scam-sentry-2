import dns from 'node:dns';

const dnsPromises = dns.promises;

let installed = false;
let savedLookup = null;
let savedPromiseLookup = null;
const entries = new Map();

const CACHE_KEY_LIMIT = 4096;

function cacheKey(hostname, options) {
  const all = Boolean(options?.all) ? '|all' : '';
  return `${String(hostname).toLowerCase()}${all}`;
}

function evictOldest(limit) {
  while (entries.size >= limit) {
    let oldest = null;
    for (const key of entries.keys()) {
      if (oldest === null || key < oldest) oldest = key;
    }
    if (oldest !== null) entries.delete(oldest);
  }
}

function wrapLookup(original) {
  return function cachedLookup(hostname, options, callback) {
    const key = cacheKey(hostname, options);
    if (entries.has(key)) {
      const entry = entries.get(key);
      if (entry.expiresAt > Date.now()) {
        const value = entry.value;
        if (typeof callback === 'function') return process.nextTick(callback, null, value);
        return Promise.resolve(value);
      }
      entries.delete(key);
    }
    const result = original.call(dns, hostname, options, callback);
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        cacheValue(key, value, options);
        return value;
      });
    }
    return result;
  };
}

function wrapPromiseLookup(original) {
  return async function cachedPromiseLookup(hostname, options) {
    const key = cacheKey(hostname, options);
    if (entries.has(key)) {
      const entry = entries.get(key);
      if (entry.expiresAt > Date.now()) return entry.value;
      entries.delete(key);
    }
    const value = await original.call(dnsPromises, hostname, options);
    cacheValue(key, value, options);
    return value;
  };
}

function cacheValue(key, value) {
  if (Array.isArray(value) && value.length === 0) return; // never cache resolvable-only
  entries.set(key, {
    value,
    at: Date.now(),
    expiresAt: Date.now() + cacheTtl,
  });
  evictOldest(CACHE_KEY_LIMIT);
}

let cacheTtl = 60_000;

export function installDnsCache(opts = {}) {
  cacheTtl = opts.ttlMs ?? cacheTtl;
  if (installed) return;
  savedLookup = dns.lookup;
  savedPromiseLookup = dnsPromises.lookup;
  try {
    dns.lookup = wrapLookup(savedLookup);
    dnsPromises.lookup = wrapPromiseLookup(savedPromiseLookup);
    installed = true;
  } catch {
    dns.lookup = savedLookup;
    dnsPromises.lookup = savedPromiseLookup;
    installed = false;
    throw new Error('could not install the dns cache');
  }
}

export function uninstallDnsCache() {
  if (!installed) return;
  dns.lookup = savedLookup;
  dnsPromises.lookup = savedPromiseLookup;
  savedLookup = null;
  savedPromiseLookup = null;
  installed = false;
  entries.clear();
}

export function flushDnsCache() {
  entries.clear();
}

export function cachedDnsEntries() {
  return Array.from(entries.entries()).map(([key, entry]) => ({
    key,
    at: entry.at,
    expiresAt: entry.expiresAt,
  }));
}

export function isDnsCacheInstalled() {
  return installed;
}