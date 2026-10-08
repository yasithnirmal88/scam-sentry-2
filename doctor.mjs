#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isMainModule } from './lib/entry.mjs';
import { resolveDataRoot, SYSTEM_ROOT } from './lib/paths.mjs';

export const TEMPLATES = [
  { target: 'config/profile.yml', template: 'config/profile.example.yml', auto: false },
  { target: 'modes/_profile.md', template: 'modes/_profile.template.md', auto: true },
  { target: 'modes/_custom.md', template: 'modes/_custom.template.md', auto: true },
];

export const REQUIRED = TEMPLATES.map((entry) => entry.target);

const NODE_MIN = [18, 17];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function checkYaml(file) {
  let yaml;
  try {
    const require = createRequire(import.meta.url);
    yaml = require('js-yaml');
  } catch {
    return { ok: true, unavailable: true };
  }
  try {
    yaml.load(read(file));
    return { ok: true, unavailable: false };
  } catch (error) {
    return { ok: false, unavailable: false, message: error?.message ?? String(error) };
  }
}

export function runDoctor(opts = {}) {
  const env = opts.env ?? process.env;
  const dataRoot = opts.root ? path.resolve(opts.root) : resolveDataRoot(env);
  const missing = [];
  const unpersonalized = [];
  const warnings = [];

  for (const entry of TEMPLATES) {
    const targetPath = path.join(dataRoot, entry.target);
    if (!fs.existsSync(targetPath)) {
      missing.push(entry.target);
      continue;
    }
    const templatePath = path.join(SYSTEM_ROOT, entry.template);
    if (fs.existsSync(templatePath)) {
      let same = false;
      try {
        same = read(targetPath) === read(templatePath);
      } catch {
        same = false;
      }
      if (same) unpersonalized.push(entry.target);
    }
  }

  if (!fs.existsSync(path.join(dataRoot, 'portals.yml'))) {
    warnings.push('portals.yml is absent — board scanning stays disabled until you add one');
  }

  const profilePath = path.join(dataRoot, 'config/profile.yml');
  if (fs.existsSync(profilePath)) {
    const yamlCheck = checkYaml(profilePath);
    if (!yamlCheck.ok) warnings.push(`config/profile.yml is not valid YAML: ${yamlCheck.message.split('\n')[0]}`);
  }

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < NODE_MIN[0] || (major === NODE_MIN[0] && minor < NODE_MIN[1])) {
    warnings.push(`node ${process.versions.node} is older than the required ${NODE_MIN.join('.')}`);
  }

  try {
    const require = createRequire(import.meta.url);
    require.resolve('js-yaml');
  } catch {
    warnings.push('js-yaml is not installed — run npm install');
  }

  return {
    onboardingNeeded: missing.length > 0 || unpersonalized.length > 0,
    missing,
    unpersonalized,
    warnings,
  };
}

export function initTemplates(opts = {}) {
  const env = opts.env ?? process.env;
  const dataRoot = opts.root ? path.resolve(opts.root) : resolveDataRoot(env);
  const copied = [];
  for (const entry of TEMPLATES) {
    if (!entry.auto) continue;
    const targetPath = path.join(dataRoot, entry.target);
    if (fs.existsSync(targetPath)) continue;
    const templatePath = path.join(SYSTEM_ROOT, entry.template);
    if (!fs.existsSync(templatePath)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(templatePath, targetPath);
    copied.push(entry.target);
  }
  return copied;
}

function printHuman(report, copied) {
  console.log(`onboarding needed: ${report.onboardingNeeded ? 'yes' : 'no'}`);
  if (copied && copied.length) console.log(`init: copied ${copied.join(', ')}`);
  for (const [label, list] of [
    ['missing', report.missing],
    ['unpersonalized', report.unpersonalized],
    ['warnings', report.warnings],
  ]) {
    for (const item of list) console.log(`${label}: ${item}`);
  }
  if (report.onboardingNeeded) {
    console.log('next: personalize config/profile.yml, then run node doctor.mjs --init-templates and edit modes/_profile.md');
  }
}

function main(argv) {
  const json = argv.includes('--json');
  const shouldInit = argv.includes('--init-templates');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : null;
  if (rootIndex >= 0 && !root) {
    console.error('--root requires a directory argument');
    return 2;
  }
  const copied = shouldInit ? initTemplates({ root }) : [];
  const report = runDoctor({ root });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report, copied);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
