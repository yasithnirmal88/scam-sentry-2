import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { SYSTEM_ROOT } from './paths.mjs';

export const STATES_FILE = 'templates/states.yml';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function assertUniqueKey(map, key, label) {
  const lower = String(key).toLowerCase();
  if (map.has(lower)) throw new ConfigError(`duplicate ${label}: ${key}`);
  map.set(lower, true);
}

export function loadStates(systemRoot = SYSTEM_ROOT) {
  const file = path.join(systemRoot, STATES_FILE);
  if (!fs.existsSync(file)) throw new ConfigError(`missing ${STATES_FILE}`);
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object') throw new ConfigError(`${STATES_FILE} is empty`);
  if (!Array.isArray(doc.states) || doc.states.length === 0) throw new ConfigError('states list is empty');

  const dashboardGroups = Array.isArray(doc.dashboard_groups) ? doc.dashboard_groups.map(String) : [];
  const riskLevels = Array.isArray(doc.risk_levels) ? doc.risk_levels.map(String) : [];
  const confidenceLevels = Array.isArray(doc.confidence_levels) ? doc.confidence_levels.map(String) : [];
  const sentinels = Array.isArray(doc.cell_sentinels) ? doc.cell_sentinels.map(String) : [];
  if (!riskLevels.length) throw new ConfigError('risk_levels is empty');
  if (!confidenceLevels.length) throw new ConfigError('confidence_levels is empty');

  const seen = new Map();
  const byKey = new Map();
  const states = [];
  for (const entry of doc.states) {
    if (!entry || typeof entry !== 'object') throw new ConfigError('malformed state entry');
    const name = String(entry.name ?? '').trim();
    if (!name) throw new ConfigError('state without a name');
    assertUniqueKey(seen, name, 'state name');
    const group = String(entry.dashboard_group ?? '');
    if (!dashboardGroups.includes(group)) throw new ConfigError(`state ${name}: unknown dashboard_group ${group}`);
    const state = {
      name,
      terminal: entry.terminal === true,
      requiresReport: entry.requires_report === true,
      dashboardGroup: group,
      aliases: Array.isArray(entry.aliases) ? entry.aliases.map((alias) => String(alias)) : [],
    };
    for (const alias of state.aliases) assertUniqueKey(seen, alias, `alias of ${name}`);
    byKey.set(name.toLowerCase(), name);
    for (const alias of state.aliases) byKey.set(alias.toLowerCase(), name);
    states.push(state);
  }

  return {
    file,
    states,
    byKey,
    riskLevels,
    confidenceLevels,
    sentinels,
    dashboardGroups,
    terminal: new Set(states.filter((state) => state.terminal).map((state) => state.name)),
    requiresReport: new Set(states.filter((state) => state.requiresReport).map((state) => state.name)),
    names: states.map((state) => state.name),
  };
}

export function resolveState(catalog, value) {
  if (typeof value !== 'string') return null;
  return catalog.byKey.get(value.trim().toLowerCase()) ?? null;
}

export function isTerminal(catalog, name) {
  return catalog.terminal.has(name);
}

export function requiresReport(catalog, name) {
  return catalog.requiresReport.has(name);
}

export function isSentinel(catalog, value) {
  if (typeof value !== 'string') return false;
  const cell = value.trim();
  if (!cell) return true;
  return catalog.sentinels.some((sentinel) => sentinel.toLowerCase() === cell.toLowerCase());
}

export function resolveEnum(levels, value) {
  if (typeof value !== 'string') return null;
  const cell = value.trim().toLowerCase();
  const match = levels.find((level) => level.toLowerCase() === cell);
  return match ?? null;
}
