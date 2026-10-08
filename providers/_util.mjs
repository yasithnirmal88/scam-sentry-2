export function hostOf(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  return text.split('/')[0].toLowerCase();
}

export function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

export function text(value) {
  return String(value ?? '').trim();
}

export function firstPresent(...values) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return '';
}

export function hostMatchesSuffix(url, suffixes) {
  const host = hostOf(url);
  return suffixes.some((suffix) => {
    const anchored = suffix.toLowerCase();
    return host === anchored || host.endsWith(`.${anchored}`);
  });
}