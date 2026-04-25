# QUALITY_GATES

What "done" means and how to prove it. Complete reference:
[`skills/quality-gates/SKILL.md`](skills/quality-gates/SKILL.md).

## The nine-tier ladder

Run from the repo root.

### Tier 0 — Agent-doc consistency ✅ mandatory for any `.agent/` edit

```bash
python scripts/smoke_test.py --tier 0
```

**Passes if**: no stale PySide/Qt current-UI claims in `.agent/*.md` /
`CLAUDE.md` / `AGENTS.md`; every documented command / path resolves;
`manifest.yaml` references files that exist. Delegates to
[`scripts/check_agent_docs.py`](../scripts/check_agent_docs.py).

**When mandatory**: every `.agent/` edit + every session start +
every pre-close.

### Tier 1 — Imports ✅ mandatory for any non-doc change

```bash
python scripts/smoke_test.py --tier 1
```

Every package + submodule imports without error. No display
required. ~1 s.

### Tier 2 — Headless figures ✅ mandatory for any non-doc change

```bash
python scripts/smoke_test.py --tier 2
```

USAF + FPN + DoF figure builders + ISP modes + chromatic shift +
tilt-plane + stability curves all run against synthetic data and
return Figures. Writes PNGs into `outputs/smoke/`. matplotlib Agg
backend. ~3–5 s.

### Tier 3 — FastAPI endpoints ✅ mandatory for backend/data change

```bash
python scripts/smoke_test.py --tier 3
```

Boots `mantisanalysis.server:app` via `fastapi.testclient.TestClient`
in-process and exercises:

- `GET /api/health`
- `POST /api/sources/load-sample`
- `GET /api/sources/<id>/channel/<ch>/thumbnail.png`
- `POST /api/usaf/measure`
- `POST /api/fpn/compute` + `/measure` + `/measure_batch` +
  `/stability` + `/analyze`
- `POST /api/dof/compute` (lean + rich) + `/stability` + `/analyze`
- ISP modes are reachable via `GET /api/isp/modes` (exercised in
  `tests/web/test_web_boot.py::test_isp_modes_api_reachable`).

No external uvicorn, no display. ~2–4 s.

### Tier 4 — Browser smoke 🟡 opt-in, mandatory for UI changes

```bash
pip install -e '.[web-smoke]' && playwright install chromium
pytest -m web_smoke -q
```

Covers `tests/web/test_web_boot.py`:

- React mounts ≥ 1 child under `#root`.
- Three mode-rail buttons (USAF / FPN / DoF) visible.
- No uncaught console errors after 2 s.
- `/api/isp/modes` returns the v1 mode catalog with `rgb_nir`
  defaults intact.

Wall: ~5–10 s (first test pays ~3 s for uvicorn; reused across the
session).

### Tier 5 — Feature Playwright 🟡 mandatory on new user flows

`tests/web/test_<feature>.py` per flow. Use accessible locators +
web-first assertions. See
[`skills/playwright-e2e-verification/SKILL.md`](skills/playwright-e2e-verification/SKILL.md).

### Tier 6 — Visual regression 🔵 mandatory on layout/typography changes (when baseline exists)

Via `expect(locator).to_have_screenshot(...)` — not yet adopted as a
standing baseline; first initiative to adopt it establishes the
policy. See
[`skills/visual-regression/SKILL.md`](skills/visual-regression/SKILL.md).

### Tier 7 — Performance 🟡 mandatory on data-heavy / export / visualization changes

Input latency + re-render count + response time + payload size.
See [`skills/performance-profiling/SKILL.md`](skills/performance-profiling/SKILL.md).

## Per-change-type mandatory tiers

| Change type | Required |
|---|---|
| Docs only (`.agent/*.md`, `README.md`, `CLAUDE.md`) | 0 |
| Analysis-math edit | 1, 2 |
| Figure builder | 1, 2 |
| FastAPI route / schema / session | 1, 2, 3 |
| I/O / extractor / ISP mode | 1, 2, 3 |
| React component | 1, 2, 3, 4 |
| Canvas / chart / export UI | 1, 2, 3, 4, 6 (when baseline exists), 8 |
| New user flow | 1, 2, 3, 4, 5, 7 |
| Visual refactor (tokens, typography) | 1, 2, 3, 4, 6 |
| Accessibility work | 1, 2, 3, 4, 7 |
| Data-heavy path | 1, 2, 3, 4, 8 |
| Dependency add / upgrade | 0, 1, 2, 3 (or 4 if frontend dep) |
| CI change | 0, 1 (workflow parses) |
| Major feature initiative | all relevant tiers + reviewer pass + [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) |

## Unit + headless + server tests

```bash
python -m pytest -q
```

Must be green on every push. 40+ tests as of 2026-04-24. New changes
add tests, not just features.

## Lint

```bash
python -m ruff check mantisanalysis scripts tests
```

Conservative ruleset. Fix failures; not CI-blocking today.

## Type-check

```bash
python -m mypy mantisanalysis
```

Progressive. Warnings expected; informational, not blocking.

## CI

GitHub Actions at `.github/workflows/smoke.yml`:

- Tier 1 + `pytest -m "not web_smoke"` on Ubuntu, macOS, Windows,
  Python 3.10 / 3.11 / 3.12 / 3.13.
- Tier 2 on Ubuntu (Agg backend; no display needed).
- Tier 3 runs in-process via TestClient.
- Tier 0 docs-consistency ready to wire (small; runs in < 1 s).
- Tier 4 (Playwright) not wired in CI — chromium install is ~300 MB
  and needs a budget decision.

## Acceptance checklist

Before claiming any change complete, use
[`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md). Summary:

- [ ] Every mandatory tier for the change type green.
- [ ] `pytest -q` green.
- [ ] Docs synced per
      [`skills/docs-sync/SKILL.md`](skills/docs-sync/SKILL.md).
- [ ] Reviewer findings resolved (P0/P1) or deferred with BACKLOG
      entry (P2/P3).
- [ ] HANDOFF + Status + CHANGELOG updated.
- [ ] Final response to user is honest about what was verified.
