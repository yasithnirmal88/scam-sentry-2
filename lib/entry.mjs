import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function isMainModule(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  let href;
  try {
    href = pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(url) === normalize(href);
}
