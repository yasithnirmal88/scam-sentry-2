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
 root scripts (doctor, update-system, test-all) ──► deterministic checks
 lib/  (paths, files, entry)  ──► shared plumbing
 scripts/check-syntax.mjs     ──► repo-wide lint
 tests/                       ──► the safety net
```

Planned components, in build order:

- **Scanner** (`scan.mjs` + `providers/`): zero-token discovery over public,
  no-auth sources behind an SSRF-guarded HTTP transport with host allowlists
  and `redirect: 'error'`.
- **Analysis** (`modes/` evaluation workflow): risk indicators, legitimacy
  tiers, and a normative report structure, with deterministic validators that
  catch drift in model output.
- **Findings tracker** (`data/findings.md`): canonical states, TSV merge,
  deduplication, and a numbered health gate.
- **Liveness**: never analyze a dead posting; only explicit closure evidence
  counts as closed.

## The judgment/code split

Prompts produce judgment output. They cannot enforce, secure, or reproduce
anything. Anything that must be exact, secure, reproducible, or free is code:

| Concern | Where it lives |
|---|---|
| Fetching, allowlists, redirect policy, address guards | `providers/` (later phases) |
| Tracker writes, merge, dedup, status validation | tracker scripts (later phases) |
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
- No secrets in the repo; no `.env`; configuration secrets come from
  environment variables only.
