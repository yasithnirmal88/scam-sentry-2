import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, NODE, run, rmSync } from './helpers.mjs';

const DOCTOR = path.join(ROOT, 'doctor.mjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-doctor-'));
}

function doctor(args) {
  return run(NODE, [DOCTOR, ...args]);
}

test('doctor --json reports the contract on an empty root', () => {
  const dir = tempRoot();
  try {
    const result = doctor(['--json', '--root', dir]);
    assert.strictEqual(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepStrictEqual(
      Object.keys(report).sort(),
      ['missing', 'onboardingNeeded', 'unpersonalized', 'warnings'],
    );
    assert.strictEqual(report.onboardingNeeded, true);
    assert.deepStrictEqual(report.missing, ['config/profile.yml', 'modes/_profile.md', 'modes/_custom.md']);
    assert.deepStrictEqual(report.unpersonalized, []);
    assert.ok(Array.isArray(report.warnings));
    assert.ok(
      report.warnings.some((item) => item.includes('portals.yml')),
      'expected a portals.yml warning',
    );
  } finally {
    rmSync(dir);
  }
});

test('--init-templates copies mode templates and flags them as unpersonalized', () => {
  const dir = tempRoot();
  try {
    const result = doctor(['--init-templates', '--json', '--root', dir]);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'modes', '_profile.md')));
    assert.ok(fs.existsSync(path.join(dir, 'modes', '_custom.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'config', 'profile.yml')));
    const report = JSON.parse(result.stdout);
    assert.deepStrictEqual(report.missing, ['config/profile.yml']);
    assert.deepStrictEqual(report.unpersonalized, ['modes/_profile.md', 'modes/_custom.md']);
    assert.strictEqual(report.onboardingNeeded, true);
  } finally {
    rmSync(dir);
  }
});

test('personalized files clear the unpersonalized flags', () => {
  const dir = tempRoot();
  try {
    doctor(['--init-templates', '--root', dir]);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'profile.yml'), 'language:\n  output: en\n');
    fs.writeFileSync(path.join(dir, 'modes', '_profile.md'), '# my targeting\n');
    fs.writeFileSync(path.join(dir, 'modes', '_custom.md'), '# my rules\n');
    const result = doctor(['--json', '--root', dir]);
    assert.strictEqual(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepStrictEqual(report.missing, []);
    assert.deepStrictEqual(report.unpersonalized, []);
    assert.strictEqual(report.onboardingNeeded, false);
  } finally {
    rmSync(dir);
  }
});

test('an unparsable profile surfaces as a warning', () => {
  const dir = tempRoot();
  try {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'profile.yml'), 'language: [unclosed\n');
    const result = doctor(['--json', '--root', dir]);
    assert.strictEqual(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(
      report.warnings.some((item) => item.includes('profile.yml') && item.includes('YAML')),
      `expected a YAML warning, got ${JSON.stringify(report.warnings)}`,
    );
  } finally {
    rmSync(dir);
  }
});
