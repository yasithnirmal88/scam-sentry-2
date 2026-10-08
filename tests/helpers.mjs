import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkFiles, relativePosix } from '../lib/files.mjs';

export { walkFiles, relativePosix };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NODE = process.execPath;
export const QUICK = /^(1|true|yes)$/i.test(process.env.SCAM_SENTRY_QUICK ?? '');

const counts = { pass: 0, fail: 0, warn: 0 };
let printed = false;

export function pass(label = '') {
  counts.pass += 1;
  if (label) console.log(`ok - ${label}`);
  return true;
}

export function fail(label, detail = '') {
  counts.fail += 1;
  console.error(`not ok - ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

export function warn(label) {
  counts.warn += 1;
  console.warn(`warn - ${label}`);
  return false;
}

export function summaryLine() {
  return `SUMMARY pass=${counts.pass} fail=${counts.fail} warn=${counts.warn}`;
}

export function finish() {
  if (printed) return summaryLine();
  printed = true;
  console.log(summaryLine());
  if (counts.fail > 0) process.exitCode = 1;
  return summaryLine();
}

process.on('exit', finish);

const ALLOWED = new Set([path.resolve(process.execPath)]);
const norm = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

export function run(command, args = [], opts = {}) {
  const resolved = path.resolve(command);
  let allowed = false;
  for (const candidate of ALLOWED) if (norm(candidate) === norm(resolved)) allowed = true;
  if (!allowed) throw new Error(`run(): executable not allowlisted: ${command}`);
  const result = spawnSync(resolved, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeout ?? 180000,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

const KIND_CODE = 0;
const KIND_STRING = 1;
const KIND_COMMENT = 2;

export function classifyJs(code) {
  const kinds = new Uint8Array(code.length);
  const braces = [];
  let mode = 'code';
  let i = 0;
  const mark = (kind, ...indexes) => {
    for (const index of indexes) if (index < kinds.length) kinds[index] = kind;
  };
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        mark(KIND_COMMENT, i, i + 1);
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        mark(KIND_COMMENT, i, i + 1);
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        mode = ch === "'" ? 'sq' : 'dq';
        mark(KIND_STRING, i);
        i += 1;
        continue;
      }
      if (ch === '`') {
        mode = 'tpl';
        mark(KIND_STRING, i);
        i += 1;
        continue;
      }
      if (ch === '{') {
        braces.push('{');
        i += 1;
        continue;
      }
      if (ch === '}') {
        const top = braces.pop();
        if (top === '}') mode = 'tpl';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        i += 1;
        continue;
      }
      mark(KIND_COMMENT, i);
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mark(KIND_COMMENT, i, i + 1);
        mode = 'code';
        i += 2;
        continue;
      }
      if (ch !== '\n') mark(KIND_COMMENT, i);
      i += 1;
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      const quote = mode === 'sq' ? "'" : '"';
      mark(KIND_STRING, i);
      if (ch === '\\') {
        mark(KIND_STRING, i + 1);
        i += 2;
        continue;
      }
      i += 1;
      if (ch === quote || ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'tpl') {
      if (ch === '\\') {
        mark(KIND_STRING, i, i + 1);
        i += 2;
        continue;
      }
      if (ch === '`') {
        mark(KIND_STRING, i);
        mode = 'code';
        i += 1;
        continue;
      }
      if (ch === '$' && next === '{') {
        braces.push('}');
        mode = 'code';
        i += 2;
        continue;
      }
      mark(KIND_STRING, i);
      i += 1;
      continue;
    }
  }
  return kinds;
}

export function codeMask(code) {
  const kinds = classifyJs(code);
  let out = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    out += kinds[i] === KIND_CODE ? ch : ch === '\n' ? '\n' : ' ';
  }
  return out;
}

export function stripJsComments(code) {
  const kinds = classifyJs(code);
  let out = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (kinds[i] === KIND_COMMENT && ch !== '\n') continue;
    out += ch;
  }
  return out;
}

export function isCodeRange(mask, start, end) {
  return /\S/.test(mask.slice(start, end));
}

export function rmSync(target, opts = {}) {
  let attempts = 4;
  for (;;) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, ...opts });
      return;
    } catch (error) {
      attempts -= 1;
      const retryable = ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code);
      if (attempts > 0 && retryable) {
        const until = Date.now() + 50;
        while (Date.now() < until) {}
        continue;
      }
      throw error;
    }
  }
}

export function captureConsoleErrors(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

export function formatRunFailure(result, label = 'command failed') {
  const tail = (text) => text.trim().split('\n').slice(-8).join('\n');
  return `${label} (exit ${result.code})\n--- stdout ---\n${tail(result.stdout)}\n--- stderr ---\n${tail(result.stderr)}`;
}
