# Shared evaluation conventions

Conventions every evaluation run follows, no matter which mode starts it.

## Signal language

- Every risk indicator is a **signal**, never a verdict.
- Write observations like "recruiter uses a free-email domain while claiming
  to represent a real company", not "this is a scam".
- If the posting passes all checks, say so by listing what was verified, not
  by declaring the employer "definitely legit".

## Evidence rule

- Quote verbatim evidence next to every risk indicator. One-line snippets are
  enough; truncated lines get ellipses.
- If a signal came from a secondary search, name the source and the date.
- Keep the job description verbatim in the "Job Description (archived
  verbatim)" section, or reference a captured `jds/` file.

## Machine summary

- Every report ends its header with a `<!-- machine-summary -->` YAML block.
- The YAML holds enums only: risk level, confidence, categories, indicator
  codes, and the final decision. No prose.
- Run `node verify-risk.mjs` after writing a report; it fails on enum drift,
  level/indicator contradictions, and out-of-order sections.

## Section order

Write the report in the normative order, or `verify-risk.mjs` flags it:

1. `## A) Posting Facts`
2. `## G) Posting Legitimacy`
3. `## Risk Assessment`
4. `## Employer Verification`
5. `## Recommended Actions`
6. `## Risk Summary`
7. `## Score Evidence`
8. `## Job Description (archived verbatim)`

## Confidence calibration

- **High**: several independent direct signals, or strong confirming evidence.
- **Medium**: some signals, none conclusive.
- **Low**: a single weak signal with plausible alternate explanations.