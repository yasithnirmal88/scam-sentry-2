import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, pass, fail } from './helpers.mjs';
import {
  SYSTEM_ROOT,
  MARKER_FILE,
  USER_PATHS,
  resolveDataRoot,
  resolveTrackerRead,
  resolveTrackerWrite,
  isUserPath,
  listSystemFiles,
} from '../lib/paths.mjs';

const check = (label, condition, detail = '') => {
  if (condition) pass(label);
  else fail(label, detail);
};

check('default data root is the system root', resolveDataRoot({}) === SYSTEM_ROOT);

const absolute = path.join(os.tmpdir(), 'ss-abs-root');
check('absolute env root wins', resolveDataRoot({ SCAM_SENTRY_ROOT: absolute }) === absolute);

check(
  'relative env root resolves against the system root',
  resolveDataRoot({ SCAM_SENTRY_ROOT: path.join('sub', 'dir') }) === path.join(SYSTEM_ROOT, 'sub', 'dir'),
);

const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-marker-'));
fs.writeFileSync(path.join(markerRoot, MARKER_FILE), 'stored-data\n');
check('marker file content resolves relative', resolveDataRoot({}, { systemRoot: markerRoot }) === path.join(markerRoot, 'stored-data'));
fs.writeFileSync(path.join(markerRoot, MARKER_FILE), absolute);
check('marker file supports absolute content', resolveDataRoot({}, { systemRoot: markerRoot }) === absolute);

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tracker-'));
check(
  'tracker read falls back to canonical path',
  resolveTrackerRead({}, { dataRoot }) === path.join(dataRoot, 'data', 'findings.md'),
);
check(
  'tracker write always targets the canonical path',
  resolveTrackerWrite({}, { dataRoot }) === path.join(dataRoot, 'data', 'findings.md'),
);
fs.mkdirSync(path.join(dataRoot, 'data'));
fs.writeFileSync(path.join(dataRoot, 'data', 'findings.md'), 'rows');
check(
  'tracker read prefers data/findings.md',
  resolveTrackerRead({}, { dataRoot }) === path.join(dataRoot, 'data', 'findings.md'),
);
const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-legacy-'));
fs.writeFileSync(path.join(legacyRoot, 'findings.md'), 'legacy');
check(
  'tracker read falls back to the legacy root file',
  resolveTrackerRead({}, { dataRoot: legacyRoot }) === path.join(legacyRoot, 'findings.md'),
);
check(
  'tracker env override wins for writes',
  resolveTrackerWrite({ SCAM_SENTRY_TRACKER: path.join('data', 'other.md') }, { dataRoot }) ===
    path.join(dataRoot, 'data', 'other.md'),
);

check('profile is a user path', isUserPath('config/profile.yml'));
check('data dir is a user path', isUserPath(path.join('data', 'findings.md')));
check('analysis profile is a user path', isUserPath('modes/_profile.md'));
check('shared mode file is not a user path', !isUserPath('modes/_shared.md'));
check('readme is not a user path', !isUserPath('README.md'));

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sysfiles-'));
for (const rel of [
  'README.md',
  'doctor.mjs',
  'config/profile.yml',
  'modes/_profile.md',
  'data/findings.md',
  'reports/r.md',
]) {
  fs.mkdirSync(path.dirname(path.join(fixture, rel)), { recursive: true });
  fs.writeFileSync(path.join(fixture, rel), 'x');
}
fs.mkdirSync(path.join(fixture, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'node_modules', 'dep.mjs'), 'x');

const systemFiles = listSystemFiles({ systemRoot: fixture });
const expected = ['README.md', 'doctor.mjs'];
if (JSON.stringify(systemFiles) === JSON.stringify(expected)) {
  pass('listSystemFiles excludes user-layer and vendored files');
} else {
  fail('listSystemFiles excludes user-layer and vendored files', JSON.stringify(systemFiles));
}

const overlap = USER_PATHS.filter((entry) => systemFiles.includes(entry));
check('no declared user path is reported as system', overlap.length === 0, JSON.stringify(overlap));

if (fs.existsSync(path.join(ROOT, MARKER_FILE))) {
  fail('repo root must not carry the local data marker', MARKER_FILE);
} else {
  pass('repo root carries no local data marker');
}
