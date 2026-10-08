import fs from 'node:fs';
import path from 'node:path';
import { pass, fail } from './helpers.mjs';
import { tempRoot } from './fixtures.mjs';
import {
  loadStates,
  resolveState,
  isTerminal,
  requiresReport,
  isSentinel,
  resolveEnum,
  ConfigError,
} from '../lib/states.mjs';

const check = (label, condition, detail = '') => {
  if (condition) pass(label);
  else fail(label, detail);
};

const throwsConfigError = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ConfigError ? error : new Error(`wrong error type: ${error}`);
  }
};

const catalog = loadStates();

const expectedNames = ['Queued', 'Analyzed', 'Followup', 'Confirmed', 'Cleared', 'Discarded', 'Archived'];
check(
  'states load in declaration order',
  JSON.stringify(catalog.names) === JSON.stringify(expectedNames),
  JSON.stringify(catalog.names),
);

check('canonical spelling resolves to itself', resolveState(catalog, 'Followup') === 'Followup');
check('aliases resolve to the canonical state', resolveState(catalog, 'follow-up') === 'Followup');
check('aliases resolve case-insensitively', resolveState(catalog, 'PENDING') === 'Queued');
check('spanish alias resolves', resolveState(catalog, 'analizado') === 'Analyzed');
check('input is trimmed before lookup', resolveState(catalog, '  queued  ') === 'Queued');
check('unknown state resolves to null', resolveState(catalog, 'Weird') === null);
check('non-string input resolves to null', resolveState(catalog, 42) === null);

check('confirmed is terminal', isTerminal(catalog, 'Confirmed') === true);
check('queued is not terminal', isTerminal(catalog, 'Queued') === false);
check('queued requires no report', requiresReport(catalog, 'Queued') === false);
check('analyzed requires a report', requiresReport(catalog, 'Analyzed') === true);
check('discarded requires no report', requiresReport(catalog, 'Discarded') === false);

check('risk enum resolves canonically', resolveEnum(catalog.riskLevels, 'critical') === 'Critical');
check('risk enum trims input', resolveEnum(catalog.riskLevels, ' MEDIUM ') === 'Medium');
check('unknown risk resolves to null', resolveEnum(catalog.riskLevels, 'extreme') === null);
check('confidence enum resolves canonically', resolveEnum(catalog.confidenceLevels, 'high') === 'High');
check(
  'risk levels match the template',
  JSON.stringify(catalog.riskLevels) === JSON.stringify(['Low', 'Medium', 'High', 'Critical']),
  JSON.stringify(catalog.riskLevels),
);

check('em dash is a sentinel', isSentinel(catalog, '—') === true);
check('hyphen is a sentinel', isSentinel(catalog, '-') === true);
check('N/A is a sentinel', isSentinel(catalog, 'N/A') === true);
check('empty cell is a sentinel', isSentinel(catalog, '') === true);
check('a risk level is not a sentinel', isSentinel(catalog, 'Low') === false);
check('non-string value is not a sentinel', isSentinel(catalog, 7) === false);

const missingRoot = tempRoot();
const missingError = throwsConfigError(() => loadStates(missingRoot));
check(
  'missing states file raises ConfigError',
  missingError !== null && missingError.message.includes('missing templates/states.yml'),
  missingError ? missingError.message : 'no error thrown',
);

const duplicateRoot = tempRoot();
fs.mkdirSync(path.join(duplicateRoot, 'templates'), { recursive: true });
fs.writeFileSync(
  path.join(duplicateRoot, 'templates', 'states.yml'),
  [
    'states:',
    '  - name: Dup',
    '    dashboard_group: queued',
    '    aliases: [shared]',
    '  - name: dup',
    '    dashboard_group: queued',
    '    aliases: []',
    'risk_levels: [Low]',
    'confidence_levels: [High]',
    'dashboard_groups: [queued]',
    '',
  ].join('\n'),
  'utf8',
);
const duplicateError = throwsConfigError(() => loadStates(duplicateRoot));
check(
  'duplicate state names raise ConfigError',
  duplicateError !== null && duplicateError.message.includes('duplicate state name'),
  duplicateError ? duplicateError.message : 'no error thrown',
);

const badGroupRoot = tempRoot();
fs.mkdirSync(path.join(badGroupRoot, 'templates'), { recursive: true });
fs.writeFileSync(
  path.join(badGroupRoot, 'templates', 'states.yml'),
  [
    'states:',
    '  - name: One',
    '    dashboard_group: elsewhere',
    '    aliases: []',
    'risk_levels: [Low]',
    'confidence_levels: [High]',
    'dashboard_groups: [queued]',
    '',
  ].join('\n'),
  'utf8',
);
const groupError = throwsConfigError(() => loadStates(badGroupRoot));
check(
  'unknown dashboard group raises ConfigError',
  groupError !== null && groupError.message.includes('unknown dashboard_group'),
  groupError ? groupError.message : 'no error thrown',
);
