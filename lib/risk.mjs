import yaml from 'js-yaml';

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
export const LEGITIMACY_TIERS = ['High Confidence', 'Proceed with Caution', 'Suspicious'];
export const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low'];
export const RISK_CATEGORIES = ['Scam', 'Ghost/Stale', 'Suspicious', 'Likely Genuine'];
export const FINAL_DECISIONS = ['Apply', 'Consider', 'Research first', 'Skip'];

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

export const INDICATORS = [
  { code: 'C1', severity: 'Critical', label: 'advance/registration fee or payment requested', categories: ['Scam'] },
  { code: 'C2', severity: 'Critical', label: 'sensitive personal data demanded before a formal offer', categories: ['Scam'] },
  { code: 'C3', severity: 'Critical', label: 'guaranteed income with pressure tactics', categories: ['Scam'] },
  { code: 'C4', severity: 'Critical', label: 'confirmed scam pattern (phishing, fake checks, impersonation)', categories: ['Scam'] },
  { code: 'H1', severity: 'High', label: 'recruiter uses a free-email domain while claiming to represent a real company', categories: ['Scam'] },
  { code: 'H2', severity: 'High', label: 'strong urgency language', categories: ['Suspicious'] },
  { code: 'H3', severity: 'High', label: 'missing or vague company identity', categories: ['Suspicious'] },
  { code: 'H4', severity: 'High', label: 'email/domain does not match the claimed company', categories: ['Scam', 'Suspicious'] },
  { code: 'H5', severity: 'High', label: 'strong ghost/stale signals (evergreen reposting, no concrete team detail)', categories: ['Ghost/Stale', 'Suspicious'] },
  { code: 'M1', severity: 'Medium', label: 'vague JD (no responsibilities, team, or deliverables)', categories: ['Suspicious', 'Ghost/Stale'] },
  { code: 'M2', severity: 'Medium', label: 'no salary range where the market normally shows one', categories: ['Suspicious'] },
  { code: 'M3', severity: 'Medium', label: 'unprofessional language', categories: ['Suspicious'] },
  { code: 'M4', severity: 'Medium', label: 'minimal company online presence', categories: ['Suspicious', 'Ghost/Stale'] },
  { code: 'L1', severity: 'Low', label: 'minor title/responsibilities mismatch', categories: ['Suspicious'] },
  { code: 'L2', severity: 'Low', label: 'benefits not mentioned', categories: [] },
  { code: 'L3', severity: 'Low', label: 'single repost', categories: ['Ghost/Stale'] },
];

const BY_CODE = new Map(INDICATORS.map((indicator) => [indicator.code, indicator]));
const LOW_ONLY = new Set(['L1', 'L2', 'L3']);

export function isKnownIndicator(code) {
  return BY_CODE.has(String(code ?? '').trim().toUpperCase());
}

export function indicatorInfo(code) {
  const info = BY_CODE.get(String(code ?? '').trim().toUpperCase());
  return info ?? null;
}

export function normalizeIndicatorCodes(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/);
  const seen = new Set();
  const codes = [];
  for (const item of raw) {
    const code = String(item ?? '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export function countBySeverity(codes) {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const code of codes) {
    const info = BY_CODE.get(code);
    if (info) counts[info.severity] += 1;
  }
  return counts;
}

export function determineRiskLevel(codes) {
  const { Critical, High, Medium } = countBySeverity(codes);
  if (Critical >= 1) return 'Critical';
  if (High >= 2) return 'High';
  if (High >= 1 && Medium >= 2) return 'High';
  if (High === 1) return 'Medium';
  if (Medium >= 2) return 'Medium';
  return 'Low';
}

export function assignCategories(codes) {
  if (codes.length === 0) return ['Likely Genuine'];
  const fired = new Set();
  for (const code of codes) {
    const info = BY_CODE.get(code);
    if (!info) continue;
    for (const category of info.categories) fired.add(category);
  }
  if (fired.size === 0) return ['Likely Genuine'];
  if (fired.has('Scam')) fired.delete('Suspicious');
  return [...fired].sort();
}

export function determineConfidence(codes, level) {
  const counts = countBySeverity(codes);
  const direct = counts.Critical + counts.High;
  if (codes.length >= 4 || (direct >= 2 && codes.length >= 2)) return 'High';
  if (codes.length >= 1 && level !== 'Low') return 'Medium';
  if (codes.length >= 2) return 'Medium';
  return codes.length === 1 && LOW_ONLY.has(codes[0]) ? 'Low' : 'Medium';
}

export function tierForRiskLevel(level) {
  if (level === 'Critical' || level === 'High') return 'Suspicious';
  if (level === 'Medium') return 'Proceed with Caution';
  return 'High Confidence';
}

export function assessRisk(value) {
  const codes = normalizeIndicatorCodes(value);
  const level = determineRiskLevel(codes);
  const categories = assignCategories(codes);
  const confidence = determineConfidence(codes, level);
  const indicators = codes.map((code) => {
    const info = BY_CODE.get(code);
    return { code, severity: info?.severity ?? 'Unknown', label: info?.label ?? '' };
  });
  return {
    level,
    legitimacyTier: tierForRiskLevel(level),
    categories,
    confidence,
    indicators,
    rawCodes: codes,
  };
}

export const MACHINE_SUMMARY_MARKER = 'machine-summary';

export function renderMachineSummary(summary) {
  const doc = { ...summary };
  if (doc.indicators) doc.indicators = doc.indicators.map((entry) => (typeof entry === 'string' ? entry : entry.code));
  return `<!-- ${MACHINE_SUMMARY_MARKER} -->\n\`\`\`yaml\n${yaml.dump(doc).trimEnd()}\n\`\`\`\n<!-- /${MACHINE_SUMMARY_MARKER} -->`;
}

export function parseMachineSummary(text) {
  const source = String(text ?? '');
  const match = source.match(/<!--\s*machine-summary\s*-->([\s\S]*?)<!--\s*\/machine-summary\s*-->/);
  if (!match) return null;
  const yamlBlock = match[1].match(/```yaml\n([\s\S]*?)\n```/);
  if (!yamlBlock) return null;
  try {
    const doc = yaml.load(yamlBlock[1]);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

export function validateMachineSummary(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') {
    return ['machine summary must be a YAML object'];
  }
  const role = String(doc.role ?? '');
  if (!role.trim()) problems.push('role is empty');
  const company = String(doc.company ?? '');
  if (!company.trim()) problems.push('company is empty');
  if (doc.legitimacy_tier && !LEGITIMACY_TIERS.includes(doc.legitimacy_tier)) {
    problems.push(`legitimacy_tier must be one of ${LEGITIMACY_TIERS.join('/')}`);
  }
  if (doc.risk_level && !RISK_LEVELS.includes(doc.risk_level)) {
    problems.push(`risk_level must be one of ${RISK_LEVELS.join('/')}`);
  }
  if (doc.confidence && !CONFIDENCE_LEVELS.includes(doc.confidence)) {
    problems.push(`confidence must be one of ${CONFIDENCE_LEVELS.join('/')}`);
  }
  if (doc.categories !== undefined) {
    if (!Array.isArray(doc.categories)) problems.push('categories must be an array');
    else for (const category of doc.categories) if (!RISK_CATEGORIES.includes(category)) problems.push(`unknown category: ${category}`);
  }
  if (doc.indicators !== undefined) {
    if (!Array.isArray(doc.indicators)) problems.push('indicators must be an array');
    else for (const code of doc.indicators) if (!isKnownIndicator(code)) problems.push(`unknown indicator: ${code}`);
  }
  if (doc.final_decision && !FINAL_DECISIONS.includes(doc.final_decision)) {
    problems.push(`final_decision must be one of ${FINAL_DECISIONS.join('/')}`);
  }
  if (doc.next_action !== undefined && typeof doc.next_action !== 'string') {
    problems.push('next_action must be a string');
  }
  return problems;
}

export const REPORT_SECTIONS = [
  '## A) Posting Facts',
  '## G) Posting Legitimacy',
  '## Risk Assessment',
  '## Employer Verification',
  '## Recommended Actions',
  '## Risk Summary',
  '## Score Evidence',
  '## Job Description (archived verbatim)',
];

export function sectionOrder(text) {
  const source = String(text ?? '').split(/\r?\n/);
  const present = [];
  for (const line of source) {
    const trimmed = line.trim();
    for (const section of REPORT_SECTIONS) {
      if (trimmed === section || trimmed.startsWith(section + ' ')) present.push(section);
    }
  }
  const order = present.map((name) => REPORT_SECTIONS.indexOf(name));
  for (let i = 1; i < order.length; i += 1) {
    if (order[i] <= order[i - 1]) return { present, regular: false, firstBad: present[i] };
  }
  return { present, regular: true, firstBad: null };
}