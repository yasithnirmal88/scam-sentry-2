#!/usr/bin/env node
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, SYSTEM_ROOT } from './lib/paths.mjs';
import { resolveProvider } from './providers/_registry.mjs';
import { resolvePortalsFile } from './scan.mjs';

const KNOWN_KEYS = new Set([
  'name',
  'enabled',
  'integration',
  'url',
  'company',
  'board',
  'key',
  'endpoint',
  'search',
  'tag',
  'limit',
  'source',
  'filters',
  'notes',
]);

export async function validatePortals(opts = {}) {
  const env = opts.env ?? process.env;
  const file = resolvePortalsFile(env, opts);
  if (!fs.existsSync(file)) return { file, valid: false, entries: [], problems: [`portals file not found: ${file}`] };
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object') return { file, valid: false, entries: [], problems: [`${file} is empty`] };
  if (!Array.isArray(doc.entries)) return { file, valid: false, entries: [], problems: [`${file} must declare an "entries" list`] };

  const providersDir = opts.providersDir ?? env.SCAM_SENTRY_PROVIDERS_DIR;
  const entries = [];
  const problems = [];

  for (const [index, entry] of doc.entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      problems.push(`entries[${index}]: not an object`);
      continue;
    }
    const name = String(entry.name ?? '').trim();
    if (!name) problems.push(`entries[${index}]: missing name`);
    for (const key of Object.keys(entry)) {
      if (!KNOWN_KEYS.has(key)) problems.push(`${name || `entries[${index}]`}: unknown key "${key}"`);
    }
    if (entry.filters !== undefined && (entry.filters === null || typeof entry.filters !== 'object')) {
      problems.push(`${name}: filters must be an object`);
    }
    const resolved = await resolveProvider(entry, { dir: providersDir });
    if (!resolved) {
      problems.push(`${name || `entries[${index}]`}: no provider — set integration or a url a provider can match`);
    }
    entries.push({ name, enabled: entry.enabled !== false, integration: entry.integration ?? null, url: entry.url ?? null, resolved: resolved?.spec?.id ?? null });
  }

  return { file, valid: problems.length === 0, entries, problems };
}

export async function main(argv) {
  const asJson = argv.includes('--json');
  const report = await validatePortals({});
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  }
  console.log(`validate-portals: ${path.basename(report.file)} · ${report.entries.length} entries · ${report.valid ? 'valid' : `${report.problems.length} problem(s)`}`);
  for (const problem of report.problems) console.error(`  ${problem}`);
  return report.valid ? 0 : 1;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code));