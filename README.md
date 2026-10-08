# scam-sentry

Local-first, agent-driven analyzer for job postings. It scans public boards
without spending model tokens, judges each posting against deterministic
legitimacy signals, and writes a Markdown analysis report you can review.
Nothing is ever submitted, sent, or reported anywhere on your behalf.

**Status:** under construction, built one phase at a time.
Phase 1 (foundation) is in place: lint, test harness, path resolution,
onboarding doctor, updater scaffold.
Phase 2 (tracker) is in place: canonical states, Markdown findings tracker,
TSV merge, status transitions with a numbered health gate.

## Principles

- **Zero-token scanning.** Fetching boards and applying signal heuristics is
  plain Node — no model calls, no cost. Models are used only where judgment is
  required.
- **Data, never instructions.** Postings, company pages, form fields, and
  scraped HTML are untrusted inputs. They can influence an analysis; they can
  never issue instructions, change rules, reveal secrets, or trigger writes.
- **Files are the source of truth.** Findings live in human-readable Markdown
  and TSV files in this repository. Databases, if any, are derived indexes.
- **A human decides.** The tool analyzes and recommends. It never contacts
  anyone, never submits anything, never files reports on your behalf.

## Requirements

- Node.js >= 18.17 (no test framework, no CLI tooling — dependencies are
  `js-yaml` plus Node builtins)

## Quickstart

```bash
npm install
npm run lint          # syntax-check every .mjs file
npm test              # discover and run everything under tests/
node doctor.mjs --json   # onboarding status
```

First run:

```bash
cp config/profile.example.yml config/profile.yml   # then personalize it
node doctor.mjs --init-templates                   # creates modes/_profile.md, modes/_custom.md
$EDITOR modes/_profile.md                          # describe your own targeting
node doctor.mjs                                    # should come back clean
```

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | `scripts/check-syntax.mjs` — parses every `.mjs` in the repo |
| `npm test` | `test-all.mjs` — glob-discovers `tests/**/*.test.mjs` and runs all suites |
| `node doctor.mjs [--json] [--init-templates] [--root <dir>]` | onboarding status and template bootstrap |
| `node update-system.mjs check [--json]` | update probe (source not configured yet) |
| `node tracker.mjs [--json] [--status <s>] [--risk <r>] [--find <q>] [--limit <n>] [--init]` | read/query the findings tracker |
| `node merge-tracker.mjs [--dry-run] [--json] [--migrate] [--backfill-urls]` | merge `data/additions/*.tsv` into the tracker, then archive them |
| `node set-status.mjs <num\|substring> <State> [--note <text>] [--source <src>] [--dry-run] [--json]` | transition one row's status (logs to `data/status-log.tsv`) |
| `node reserve-report-num.mjs [--count <n>] [--release <label>] [--json]` | reserve report numbers so reports and rows never collide |
| `node normalize-statuses.mjs [--dry-run] [--json]` | canonicalize status cells and log every rewrite |
| `node dedup-tracker.mjs [--dry-run] [--json]` | remove rows that are duplicates by normalized identity |
| `node fix-report-links.mjs [--dry-run] [--json]` | rewrite report links to tracker-relative paths, warn on missing files |
| `node verify-pipeline.mjs [--json] [--summary] [--fix]` | 14 numbered health checks over states, tracker, logs, and reports |

## Layout

```
AGENTS.md  CLAUDE.md  OPENCODE.md   instructions the AI agents read
README.md  DATA_CONTRACT.md  ARCHITECTURE.md
data/      tracker (findings.md), additions, status log (your data)
reports/   one Markdown analysis per reviewed posting (your data)
modes/     agent workflows (shipped templates + your personalization)
config/    profile (example shipped, yours is user data)
lib/       shared modules (states, tracker, paths, file walking, entry guard)
templates/ shared templates (states.yml, mode scaffolds)
providers/ board scanner registry (coming in the scanner phase)
scripts/   repo-wide tooling (syntax lint)
tests/     every suite lives here and is auto-discovered
*.mjs      root scripts: doctor, tracker, merge-tracker, verify-pipeline, ...
```

## Analysis report (coming in the evaluation phase)

One Markdown report per posting, ending in a **risk assessment**: a level
(🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical), multi-label categories, a
confidence band, and severity-graded indicators — always phrased as signals,
never as a verdict about any party.

## License

MIT
