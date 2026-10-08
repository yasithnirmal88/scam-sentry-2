# Architecture

## Design principles

1. **Local-first.** Everything runs on the analyst's machine against files in
   this repository. No account, no server in the loop for the core tool.
2. **Agent-agnostic.** Judgment work lives in Markdown workflow files under
   `modes/`, executed by whatever AI coding agent loads them. Deterministic
   helpers are plain Node scripts any agent (or a human) can run.
3. **Human-in-the-loop.** The tool analyzes and recommends; a person reviews
   and acts.
4. **Zero-token by default.** Anything that can be done with plain Node —
   fetching, filtering, hashing, validating — is done with plain Node.

## Component map (current state)

```
 AI agent (any CLI)
      │ reads modes/*.md
      ▼
 modes/ workflow files ──► judgment: classification, scoring, report drafting
      │
      ▼
 root scripts (doctor, test-all, update-system, tracker, merge-tracker,
   set-status, reserve-report-num, scan, verify-pipeline, ...) ──► deterministic code
 lib/  (states, tracker, paths, files, entry)  ──► shared plumbing
 templates/states.yml                          ──► canonical tracker states
 providers/_http.mjs, _ip-guard.mjs, _dns-cache.mjs  ──► guarded transport
 providers/_registry.mjs + one .mjs per board  ──► the scanner
 scripts/check-syntax.mjs     ──► repo-wide lint
 scripts/check-providers.mjs  ──► provider contract lint
 tests/                       ──► the safety net
```

Planned components, in build order:

- **Analysis** (`modes/` evaluation workflow): risk indicators, legitimacy
  tiers, and a normative report structure, with deterministic validators that
  catch drift in model output.
- **Liveness**: never analyze a dead posting; only explicit closure evidence
  counts as closed.

Built so far:

- **Findings tracker** (`data/findings.md`): canonical states
  (`templates/states.yml`), TSV merge from `data/additions/`, status
  transitions with an audit log (`data/status-log.tsv`), report-number
  reservations, deduplication by normalized identity, and a 14-check health
  gate (`verify-pipeline.mjs`).
- **Scanner** (`scan.mjs` + `providers/`): zero-token discovery over public,
  no-auth boards. Every request goes through `providers/_http.mjs`, which
  never follows redirects (`redirect: 'error'` only; `manual` solely to read
  a `Location`), retries only timeouts/aborts/DNS failures with jittered
  backoff and `Retry-After` handling, and resolves + inspects every host
  against `providers/_ip-guard.mjs` (blocks private/loopback/link-local/
  metadata ranges before a socket is opened). `providers/_dns-cache.mjs`
  caps repeated lookups process-wide. Providers stay dumb: they receive a
  `ctx` with guarded `fetchJson/fetchText/fetchResponse` and never call
  global `fetch`; `scripts/check-providers.mjs` enforces this contract.
  `scan.mjs` reads `config/portals.example.yml` (or `<data>/portals.yml`),
  resolves each entry to a provider, filters and dedups against
  `data/scan-history.tsv`, writes Queued additions into `data/additions/`,
  and records every run in `data/scan-runs.tsv`. `validate-portals.mjs`
  and `verify-portals.mjs [--live]` keep portal configs healthy.

## The judgment/code split

Prompts produce judgment output. They cannot enforce, secure, or reproduce
anything. Anything that must be exact, secure, reproducible, or free is code:

| Concern | Where it lives |
|---|---|
| Fetching, allowlists, redirect policy, address guards | `providers/` (`_http.mjs`, `_ip-guard.mjs`, `_dns-cache.mjs`) |
| Provider routing, scan-to-additions handoff | `providers/_registry.mjs`, `scan.mjs`, `validate-portals.mjs`, `verify-portals.mjs` |
| Tracker writes, merge, dedup, status validation | root tracker scripts (`merge-tracker.mjs`, `set-status.mjs`, ...) |
| Output validation that catches model drift | validator scripts (later phases) |
| NLP-style heuristics (tokenize, similarity, extraction) | deterministic scripts, never a model call |
| Tests and CI | `tests/` + `npm run lint` |
| Evaluation, classification, drafting | `modes/*.md`, executed by the agent |

## Test discovery conventions

- Every suite lives at `tests/**/*.test.mjs`. `test-all.mjs` discovers the
  `tests/` directory by **glob** — nothing is registered by hand, so a new
  suite runs the moment it is written.
- Root-level `*.test.mjs` is not discovered; `tests/no-root-suites.test.mjs`
  fails the build if one appears.
- **Two allowed styles:**
  - *pass/fail suites* — import `pass`, `fail`, `warn` from
    `tests/helpers.mjs`. Print one line per assertion. Never call
    `process.exit()` or `finish()`; the harness owns the verdict and the
    `SUMMARY pass=N fail=N warn=W` line is emitted by an exit hook.
  - *node:test suites* — `import { test } from 'node:test'`. The runner
    child-processes them with `--test --test-reporter=tap`.
- **Hermetic:** no network, no writes outside a temp directory, never touch
  user-layer files. Fixtures go in a `mkdtemp` directory.
- Behaviour-based names are the common case
  (`paths.test.mjs`, `update-scaffold.test.mjs`); a suite named after a
  module covers exactly that one module.
- Scripts that can be imported keep their entry point behind `isMainModule`
  (`lib/entry.mjs`).

## Quality gates

- `npm run lint` — every `.mjs` parses (`scripts/check-syntax.mjs`).
- `npm test` — every suite under `tests/` passes.
- `node doctor.mjs --json` — reports the onboarding contract
  (`onboardingNeeded`, `missing`, `unpersonalized`, `warnings`).
- `node verify-pipeline.mjs --fix` — 14 numbered checks over states, the
  tracker, additions, the status log, and reports; exits non-zero on any error.
- `npm run check:providers` — every provider meets the contract and no
  provider calls global `fetch` (`scripts/check-providers.mjs`).
- `node validate-portals.mjs` — every portal entry is well-formed and
  routable to a provider.
- No secrets in the repo; no `.env`; configuration secrets come from
  environment variables only.
