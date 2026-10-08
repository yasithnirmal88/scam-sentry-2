import { defaultGuard, GuardError } from './_ip-guard.mjs';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRIES = 2;
export const ALLOWED_REDIRECTS = new Set(['error', 'manual']);

export const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const MACOS_BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function parseRetryAfterMs(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const stamp = Date.parse(raw);
  if (Number.isFinite(stamp)) return Math.max(0, stamp - Date.now());
  return null;
}

export function jitteredBackoffMs(attempt, opts = {}) {
  const base = opts.baseMs ?? 500;
  const cap = opts.capMs ?? 8000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

export function isRefusedRedirectError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('redirect mode is set to error') || message.includes('redirection refused');
}

export function isRetryableError(error) {
  if (!error) return false;
  if (isRefusedRedirectError(error)) return false;
  if (error instanceof GuardError) return false;
  const candidate = error;
  if (candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR') return true;
  const code = candidate?.code ?? candidate?.cause?.code ?? '';

  if (typeof code === 'string') {
    const upper = code.toUpperCase();
    if (upper.startsWith('ETIMEDOUT') || upper.startsWith('ENOTFOUND') || upper.startsWith('EAI_AGAIN') || upper === 'ENETUNREACH') {
      return true;
    }
  }
  const message = String(candidate?.message ?? '');
  const causeMessage = String(candidate?.cause?.message ?? '');
  return /timeout|getaddrinfo/i.test(message) || /timeout|getaddrinfo/i.test(causeMessage);
}

export function buildUrl(value) {
  return String(value ?? '').trim();
}

async function fetchOnce(guard, url, opts = {}, extra = {}) {
  await guard.assertUrl(url);
  const redirect = opts.redirect ?? 'error';
  if (!ALLOWED_REDIRECTS.has(redirect)) {
    throw new Error(`transport forbids redirect mode "${redirect}" (only error/manual are allowed)`);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = opts.fetchImpl ?? extra.fetchImpl ?? globalThis.fetch;
  const headers = {
    'user-agent': opts.userAgent ?? BROWSER_LIKE_USER_AGENT,
    ...(opts.headers ?? {}),
  };
  try {
    return await fetchImpl(url, { ...opts, redirect, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchResponse(guard, url, opts = {}, extra = {}) {
  return fetchOnce(guard, url, opts, extra);
}

export async function fetchResponseWithRetry(guard, url, opts = {}, extra = {}) {
  const attempts = opts.retries ?? DEFAULT_RETRIES;
  let attempt = 0;
  for (;;) {
    try {
      const response = await fetchOnce(guard, url, opts, extra);
      if (response?.status === 429 && attempt < attempts) {
        const wait = opts.waitMs ?? parseRetryAfterMs(response.headers.get('retry-after'));
        if (opts.waitMs !== 0) await sleep(wait ?? jitteredBackoffMs(attempt, opts));
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      if (isRetryableError(error) && attempt < attempts) {
        await sleep(jitteredBackoffMs(attempt, opts));
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function readText(response) {
  if (!response || !response.ok) throw new Error(`http ${response?.status ?? 'no-response'} for ${response?.url ?? ''}`);
  return response.text();
}

export async function fetchText(guard, url, opts = {}, extra = {}) {
  return readText(await fetchResponse(guard, url, opts, extra));
}

export async function fetchTextWithRetry(guard, url, opts = {}, extra = {}) {
  return readText(await fetchResponseWithRetry(guard, url, opts, extra));
}

export async function fetchJson(guard, url, opts = {}, extra = {}) {
  return JSON.parse(await fetchText(guard, url, opts, extra));
}

export async function fetchJsonWithRetry(guard, url, opts = {}, extra = {}) {
  return JSON.parse(await fetchTextWithRetry(guard, url, opts, extra));
}

export function makeHttpCtx(guard, opts = {}) {
  const context = {
    guard,
    fetchResponse: (url, request = {}) => fetchResponse(guard, url, { ...opts, ...request }),
    fetchResponseWithRetry: (url, request = {}) => fetchResponseWithRetry(guard, url, { ...opts, ...request }),
    fetchText: (url, request = {}) => fetchText(guard, url, { ...opts, ...request }),
    fetchTextWithRetry: (url, request = {}) => fetchTextWithRetry(guard, url, { ...opts, ...request }),
    fetchJson: (url, request = {}) => fetchJson(guard, url, { ...opts, ...request }),
    fetchJsonWithRetry: (url, request = {}) => fetchJsonWithRetry(guard, url, { ...opts, ...request }),
    sleep,
    maxPages: opts.maxPages ?? 1,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  if (opts.width) context.width = opts.width;
  if (opts.observer) context.observer = opts.observer;
  return context;
}

export function createScanContext(opts = {}) {
  return makeHttpCtx(opts.guard ?? defaultGuard(), opts);
}