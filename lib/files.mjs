import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SKIP = new Set(['node_modules', '.git']);

export function walkFiles(dir, opts = {}) {
  const ext = opts.ext ?? null;
  const skip = new Set([...DEFAULT_SKIP, ...(opts.skip ?? [])]);
  const found = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ext && !entry.name.endsWith(ext)) continue;
      found.push(full);
    }
  };
  visit(path.resolve(dir));
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function relativePosix(from, target) {
  return path.relative(from, target).split(path.sep).join('/');
}
