# Status — <slug>

> Updated at every milestone. Never delete prior content; append.

Opened: YYYY-MM-DD
Last updated: YYYY-MM-DD

## Current branch

`<branch-name>`

## Active initiative

`.agent/runs/<slug>/`

## Current milestone

M<N> — <name>

## Current focus

One sentence on what you're actively doing right now.

## Progress

- [ ] M1 — <name>
- [ ] M2 — <name>
- [ ] M3 — <name>

## Current hypothesis

(For debugging / investigation work.) What you think is happening;
what the next step confirms or falsifies.

## Modified files

`git status -sb` snapshot:

```
??  ...
 M  ...
```

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| YYYY-MM-DD | `python scripts/smoke_test.py --tier 0` | PASS | 0.5 s |
| YYYY-MM-DD | `python scripts/smoke_test.py --tier 1` | PASS | 1.0 s |

## Smoke status (last verified YYYY-MM-DD)

- Tier 0: ?
- Tier 1: ?
- Tier 2: ?
- Tier 3: ?
- Tier 4 (Playwright): ? / N/A
- pytest: ?

## Browser verification

Relevant for UI initiatives. See [`../../UI_VERIFICATION.md`](../../UI_VERIFICATION.md).

- [ ] Screenshots captured (`screenshots/` subfolder)
- [ ] Console error-free
- [ ] Network error-free
- [ ] Keyboard walk clean
- [ ] Responsive at 1024 / 1280 / 1920
- [ ] Light + dark themes verified

Screenshots:

- `screenshots/<file>.png` — caption.

## Reviewer findings

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | | | | |

## Open issues (P0 / P1 / P2 / P3)

- P0: <list or "none">
- P1: <list or "none">
- P2: <list or "none" — each links to a BACKLOG B-000N>
- P3: <list or "none">

## Blockers

- bullet (or "none")

## Known checks still required

Deferrals tracked here with a specific re-check trigger.

- bullet (or "none")

## Next concrete action

1. <specific next step — name the file / function / check>
2. <specific next step>
3. <specific next step>

## Stop / resume notes

If this session stops mid-initiative, what does the next agent need
to know that isn't already in the rest of this folder?

- Current branch: <name>
- Active milestone: <M<N>>
- Modified files: see above
- Next concrete action: see above
- Decisions this session: <list or "none">
- Reviewer findings still open: <list or "none">

## Decisions this session

- (YYYY-MM-DD) **decision**: rationale.
