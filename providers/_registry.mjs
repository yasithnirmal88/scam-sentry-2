import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostOf } from './_util.mjs';

export const PROVIDERS_DIRNAME = path.dirname(fileURLToPath(import.meta.url));

export function isProviderFile(name) {
  return /\.mjs$/.test(name) && !name.startsWith('_');
}

export function providerFiles(opts = {}) {
  const dir = opts.dir ?? PROVIDERS_DIRNAME;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => isProviderFile(name) && fs.statSync(path.join(dir, name)).isFile())
    .sort()
    .map((name) => path.join(dir, name));
}

const loaded = new Map();

export async function loadProvider(file) {
  if (loaded.has(file)) return loaded.get(file);
  const spec = (await import(pathToUrl(file))).default;
  if (!spec || typeof spec !== 'object' || !spec.id || typeof spec.fetch !== 'function') {
    throw new Error(`provider ${file} must default-export { id, fetch }`);
  }
  loaded.set(file, spec);
  return spec;
}

function pathToUrl(file) {
  return pathToFileURL(path.resolve(file)).toString();
}

export async function listProviders(opts = {}) {
  const specs = [];
  for (const file of providerFiles(opts)) {
    try {
      const spec = await loadProvider(file);
      specs.push({ file, spec });
    } catch (error) {
      specs.push({ file, error: error.message });
    }
  }
  return specs;
}

export async function specById(id, opts = {}) {
  const target = String(id ?? '').toLowerCase();
  for (const file of providerFiles(opts)) {
    const spec = await loadProvider(file);
    if (String(spec.id).toLowerCase() === target) return { file, spec };
  }
  return null;
}

export async function specsForUrl(url, opts = {}) {
  const matches = [];
  for (const file of providerFiles(opts)) {
    const spec = await loadProvider(file);
    let hit = false;
    try {
      hit = spec.keyword ? spec.keyword(url) : false;
    } catch {
      hit = false;
    }
    if (!hit && Array.isArray(spec.hosts)) {
      const host = hostOf(url);
      hit = spec.hosts.some((entry) => String(entry).toLowerCase() === host);
    }
    if (hit) matches.push({ file, spec });
  }
  return matches;
}

export async function resolveProvider(entry, opts = {}) {
  const byId = await specById(entry?.integration, opts);
  if (byId) return byId;
  if (entry?.url) {
    const matches = await specsForUrl(entry.url, opts);
    if (matches.length) return matches[0];
  }
  return null;
}

export function clearProviderCache() {
  loaded.clear();
}