#!/usr/bin/env node
import path from 'node:path';
import { isMainModule } from './lib/entry.mjs';
import { createScanContext } from './providers/_http.mjs';
import { defaultGuard, GuardError } from './providers/_ip-guard.mjs';
import { isRefusedRedirectError } from './providers/_http.mjs';
import { validatePortals } from './validate-portals.mjs';
import { resolvePortalsFile } from './scan.mjs';

export async function verifyPortals(opts = {}) {
  const env = opts.env ?? process.env;
  const base = await validatePortals({ env, ...opts });

  const noProvider = base.entries.filter((entry) => entry.enabled && !entry.resolved);
  const rows = [];
  let ok = base.valid;

  if (opts.live) {
    const ctx = createScanContext({ guard: defaultGuard(), timeoutMs: opts.timeoutMs ?? 10000 });
    for (const entry of base.entries) {
      const target = entry.url;
      if (!target) {
        rows.push({ name: entry.name, url: '', status: 'no-target' });
        continue;
      }
      let status = 'unknown';
      try {
        const response = await ctx.fetchResponse(target, { method: 'HEAD', redirect: 'error', timeoutMs: opts.timeoutMs ?? 10000 });
        status = response.ok ? 'ok' : `http_${response.status}`;
        if (!response.ok) ok = false;
      } catch (error) {
        if (error instanceof GuardError) {
          status = 'blocked';
          ok = false;
        } else if (isRefusedRedirectError(error)) {
          status = 'redirect';
        } else {
          status = 'unreachable';
          ok = false;
        }
      }
      rows.push({ name: entry.name, url: target, status });
    }
  }

  return { file: base.file, entries: base.entries, problems: base.problems, noProvider, rows, ok: ok && !(opts.live && rows.some((row) => !['ok', 'redirect', 'no-target'].includes(row.status))) };
}

export async function main(argv) {
  const asJson = argv.includes('--json');
  const live = argv.includes('--live');

  if (!live) {
    const report = await verifyPortals({ live: false });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    console.log(`verify-portals: ${path.basename(report.file)} · valid=${report.ok} · missing-provider=${report.noProvider.length}`);
    for (const entry of report.noProvider) console.error(`  no provider: ${entry.name} (${entry.url})`);
    return report.ok ? 0 : 1;
  }

  const report = await verifyPortals({ live: true });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  console.log(`verify-portals --live: ${path.basename(report.file)} · ${report.rows.length} targets · ok=${report.ok}`);
  for (const row of report.rows) console.log(`  ${row.status.padEnd(12)} ${row.name} ${row.url}`);
  return report.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code));