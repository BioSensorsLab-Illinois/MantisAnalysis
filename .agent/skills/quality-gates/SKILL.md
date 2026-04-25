---
name: quality-gates
description: Canonical tiered test/smoke/lint/typecheck/browser verification ladder for MantisAnalysis. Links to every other verification skill.
when_to_use:
  - before claiming any change complete
  - deciding which gates apply to a specific change class
  - before closing any initiative
outputs:
  - tier-by-tier pass/fail record in Status.md
related_agents: test-coverage-reviewer, playwright-verifier, docs-handoff-curator
---

# quality-gates

## When to use

- Before claiming any change complete.
- Before closing any initiative.
- Any time `AGENT_RULES.md` rule 2 applies (and it always applies to
  non-doc changes).

## The nine-tier ladder

| Tier | What | Mandatory for | Command |
|---|---|---|---|
| 0 | Agent-doc consistency | Any `.agent/` edit | `python scripts/check_agent_docs.py` |
| 1 | Imports | All non-doc changes | `python scripts/smoke_test.py --tier 1` |
| 2 | Headless figures | All non-doc changes | `python scripts/smoke_test.py --tier 2` |
| 3 | FastAPI endpoints | Any backend / data change | `python scripts/smoke_test.py --tier 3` |
| 4 | Browser smoke | Any UI / frontend change | `pytest -m web_smoke -q` |
| 5 | Feature Playwright | Any new user flow | `pytest tests/web/test_<feature>.py` |
| 6 | Visual regression | Any layout / typography change | `pytest --visual -q` (if adopted) |
| 7 | Performance | Any data-heavy / export change | `skills/performance-profiling` |

## Per-change-type mandatory tiers

| Change type | Required tiers |
|---|---|
| Docs only (`.agent/*.md`, `README.md`) | 0 |
| Analysis-math edit (`*_analysis.py`, `usaf_groups.py`) | 1, 2 |
| Figure builder (`*_render.py`, `plotting.py`, `figures.py`) | 1, 2 |
| FastAPI route / schema (`server.py`) | 1, 2, 3 |
| Session store (`session.py`) | 1, 2, 3 |
| I/O / extractor (`image_io.py`, `extract.py`, `isp_modes.py`) | 1, 2, 3 |
| React component (`web/src/*.jsx`) | 1, 2, 3, 4 |
| Canvas / chart / export UI | 1, 2, 3, 4, 6 (if baseline exists), 8 |
| New user flow | 1, 2, 3, 4, 5 |
| Visual refactor (typography, tokens) | 1, 2, 3, 4, 6 |
| Data-heavy path | 1, 2, 3, 4, 7 |
| Dependency add / upgrade | 0, 1, 2, 3 (or 4 if frontend dep) |
| CI change (`.github/workflows/`) | 0, 1 (verify workflow still parses) |
| Major feature initiative | all relevant tiers + reviewer pass |

## Tier 0 — Agent-doc consistency

- Verifies `.agent/*.md` doesn't contradict current architecture.
- Verifies no stale PySide/Qt current-UI claims.
- Verifies documented commands / paths resolve.
- Run at every `.agent/` edit + every session start.

## Tier 1 — Imports

- Every package + submodule imports.
- `~1 s`, no display.
- Blocks `git commit` of non-doc changes (soft rule).

## Tier 2 — Headless figures

- Every matplotlib figure builder produces a Figure on synthetic
  input.
- Writes PNGs to `outputs/smoke/`.
- `~3–5 s`, no display.

## Tier 3 — FastAPI endpoints

- Uses `fastapi.testclient` to exercise health + sample load +
  thumbnail + USAF/FPN/DoF measure+compute+analyze.
- No external uvicorn.
- `~2–4 s`, no display.

## Tier 4 — Browser smoke

- Opt-in (`pip install -e '.[web-smoke]'` + `playwright install
  chromium`).
- `tests/web/test_web_boot.py` asserts React mounts, three mode
  buttons visible, no console errors.
- `~5–10 s`.
- Mandatory for UI changes.

## Tier 5 — Feature Playwright

- Per-flow test under `tests/web/test_<feature>.py`.
- Uses accessible locators, web-first assertions.
- Mandatory when a new user flow ships.

## Tier 6 — Visual regression

- Screenshot comparison via Playwright's
  `expect(locator).toHaveScreenshot(...)`.
- Baselines under `tests/web/__baselines__/`.
- Not yet adopted. First initiative to adopt it establishes the
  baseline + tolerance policy.

## Tier 7 — Performance

- Frontend: input latency + re-render count.
- Backend: response time + payload size.
- Via [`performance-profiling`](../performance-profiling/SKILL.md)
  skill.

## Additional gates

### Unit + headless + server tests

```bash
python -m pytest -q
```

Must be green on every push. 40+ tests as of 2026-04-24. Target 50+
after the H5-inspector feature.

### Lint

```bash
python -m ruff check mantisanalysis scripts tests
```

Conservative ruleset. Fix failures; not CI-blocking today.

### Type-check

```bash
python -m mypy mantisanalysis
```

Progressive. Warnings expected; informational, not blocking.

## Acceptance

Before closing any initiative:

- [ ] Every tier mandatory for the change type is green.
- [ ] Tiers recorded with pass/fail + timestamp in Status.md.
- [ ] `python -m pytest -q` green.
- [ ] Lint / mypy status noted (not required green).

## Escalation

- Tier 0 fails → fix docs before any code change.
- Tier 4 fails with browser-install cost → document the dep, offer
  CI opt-in.
- A tier is flaky → fix root cause; do not retry-until-green.
