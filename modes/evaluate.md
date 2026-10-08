# Evaluation mode

Evaluate a tracked posting and produce a report in `reports/`.

## Inputs

- Tracker row (number or title substring).
- Indicator codes: `C1..C4`, `H1..H5`, `M1..M4`, `L1..L3`.

## Steps

1. Read the tracker row, the posting URL, and any captured `jds/` text.
2. Decide which indicators fired, with verbatim evidence for each.
3. Scaffold the report:

   ```
   node evaluate.mjs <row#|title> --indicators h2,m3 \
     --final-decision "Research first" --next-action "..." --dry-run
   ```

4. Inspect the dry run, then write it:

   ```
   node evaluate.mjs <row#|title> --indicators h2,m3 \
     --final-decision "Research first" --next-action "..."
   ```

5. Fill the prose sections: legitimacy walk-through, employer verification,
   recommended actions, score evidence, verbatim job description.
6. Validate the risk layer:

   ```
   node verify-risk.mjs
   node check-jd-archive.mjs
   ```

7. Move the row forward only when the reports validate clean:

   ```
   node set-status.mjs <row#> Analyzed
   ```

## Rules

- Never invent indicators; the code must map to a real observed signal.
- A `--final-decision` of "Skip" still needs a valid report and a stated
  next action.
- Do not hand-edit the machine summary after scaffolding; re-run
  `evaluate.mjs` if decisions change.
- Keep signals-only language. See `modes/_shared.md`.