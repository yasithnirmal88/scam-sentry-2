import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles, relativePosix } from './files.mjs';

export const SYSTEM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ROOT_ENV = 'SCAM_SENTRY_ROOT';
export const DATA_DIR_ENV = 'SCAM_SENTRY_DATA_DIR';
export const TRACKER_ENV = 'SCAM_SENTRY_TRACKER';
export const MARKER_FILE = '.scam-sentry-data';

export const TRACKER_CANONICAL = 'data/findings.md';
export const TRACKER_LEGACY = 'findings.md';

export const USER_PATHS = [
  'config/profile.yml',
  'modes/_profile.md',
  'modes/_custom.md',
  'portals.yml',
  'data',
  'reports',
];

export function resolveDataRoot(env = process.env, opts = {}) {
  const systemRoot = opts.systemRoot ?? SYSTEM_ROOT;
  const fromEnv = env[ROOT_ENV] || env[DATA_DIR_ENV];
  if (fromEnv) return path.resolve(systemRoot, fromEnv);
  const marker = path.join(systemRoot, MARKER_FILE);
  if (fs.existsSync(marker)) {
    const raw = fs.readFileSync(marker, 'utf8').trim();
    if (raw) return path.resolve(systemRoot, raw);
  }
  return systemRoot;
}

export function resolveTrackerRead(env = process.env, opts = {}) {
  const root = opts.dataRoot ?? resolveDataRoot(env, opts);
  if (env[TRACKER_ENV]) return path.resolve(root, env[TRACKER_ENV]);
  const canonical = path.join(root, TRACKER_CANONICAL);
  if (fs.existsSync(canonical)) return canonical;
  const legacy = path.join(root, TRACKER_LEGACY);
  if (fs.existsSync(legacy)) return legacy;
  return canonical;
}

export function resolveTrackerWrite(env = process.env, opts = {}) {
  const root = opts.dataRoot ?? resolveDataRoot(env, opts);
  if (env[TRACKER_ENV]) return path.resolve(root, env[TRACKER_ENV]);
  return path.join(root, TRACKER_CANONICAL);
}

export function isUserPath(relativePath) {
  const rel = String(relativePath).split(path.sep).join('/');
  return USER_PATHS.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

export function listSystemFiles(opts = {}) {
  const systemRoot = opts.systemRoot ?? SYSTEM_ROOT;
  return walkFiles(systemRoot)
    .map((file) => relativePosix(systemRoot, file))
    .filter((rel) => !isUserPath(rel));
}
