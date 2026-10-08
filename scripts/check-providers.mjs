#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from '../lib/entry.mjs';
import { providerFiles, loadProvider, clearProviderCache } from '../providers/_registry.mjs';

const FORBIDDEN = [
  { pattern: /\bfetch\s*\(/, reason: 'direct global fetch() — use ctx.fetchJson/fetchText/fetchResponse' },
  { pattern: /node:http/, reason: 'node:http imports are forbidden — use ctx.fetch*' },
  { pattern: /node:https/, reason: 'node:https imports are forbidden — use ctx.fetch*' },
  { pattern: /node:net/, reason: 'node:net imports are forbidden — use ctx.fetch*' },
  { pattern: /\bhttps?\.request\b/, reason: 'raw http.request is forbidden — use ctx.fetch*' },
  { pattern: /\bhttps?\.get\b/, reason: 'raw http.get is forbidden — use ctx.fetch*' },
  { pattern: /new\s+XMLHttpRequest\b/, reason: 'XHR is forbidden — use ctx.fetch*' },
  { pattern: /node:child_process/, reason: 'child processes are forbidden in providers' },
];

export function violationsForSource(source) {
  const stripped = source.replace(/\bfetch\s*\([^)]*\)\s*\{/g, '');
  const hits = [];
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(stripped)) hits.push(rule.reason);
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*import\s+.*['"](.+?)['"]/);
    if (match && match[1].includes('_http.mjs')) {
      hits.push(`import of ${match[1]} is forbidden — receive status through ctx instead`);
    }
  }
  return hits;
}

export async function checkProviders(opts = {}) {
  const dir = opts.dir;
  const files = providerFiles({ dir });
  const problems = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const base = path.basename(file);
    const id = base.replace(/\.mjs$/, '');
    for (const reason of violationsForSource(source)) {
      problems.push(`${base}: ${reason}`);
    }
    if (/import\s+.*\bfetch\b/.test(source)) {
      problems.push(`${base}: bare fetch import`);
    }
  }

  clearProviderCache();
  for (const file of files) {
    const base = path.basename(file);
    const id = base.replace(/\.mjs$/, '');
    const spec = await loadProvider(file);
    if (!spec || typeof spec !== 'object') {
      problems.push(`${base}: default export must be an object`);
      continue;
    }
    if (spec.id !== id) problems.push(`${base}: id "${spec.id}" does not match filename`);
    if (typeof spec.fetch !== 'function') problems.push(`${base}: fetch must be a function`);
    if (typeof spec.detect !== 'undefined' && typeof spec.detect !== 'function') {
      problems.push(`${base}: detect must be a function`);
    }
    const probe = spec.detect ? spec.detect({}) : null;
    if (probe !== null && probe !== undefined) {
      if (typeof probe !== 'object' || typeof probe.url !== 'string' || !/^https:\/\//.test(probe.url)) {
        problems.push(`${base}: detect({}) must return null or { url: "https://…" }`);
      }
    }
  }

  return { files: files.length, problems, ok: problems.length === 0 };
}

export async function main() {
  const report = await checkProviders({});
  if (report.ok) {
    console.log(`check-providers: ${report.files} providers, all clean`);
    return 0;
  }
  console.error(`check-providers: ${report.files} providers, ${report.problems.length} problem(s)`);
  for (const problem of report.problems) console.error(`  ${problem}`);
  return 1;
}

if (isMainModule(import.meta.url)) main().then((code) => process.exit(code));