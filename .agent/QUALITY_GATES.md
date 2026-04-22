# QUALITY_GATES

What "done" means and how to prove it.

## The smoke tiers

Run from the repo root.

### Tier 1 — Imports ✅ mandatory

```bash
python scripts/smoke_test.py --tier 1
```

**Passes if**: every package and submodule imports without error.
**No display required.** Runs in ≤ 1 s.

Purpose: catch broken imports, missing `__init__.py`, syntax errors.

### Tier 2 — Headless figures ✅ mandatory

```bash
python scripts/smoke_test.py --tier 2
```

**Passes if**: USAF + FPN + DoF figure builders all produce `Figure`
objects when fed synthetic data. Writes PNGs into `outputs/smoke/`.
**No display required.** Runs in ~3-5 s.

Purpose: catch analysis-math regressions, figure-builder breakage,
channel-schema drift, render/analysis contract violations.

### Tier 3 — Qt boot 🟡 conditionally required

```bash
python scripts/smoke_test.py --tier 3
```

**Passes if**: `QApplication` starts, `MainWindow` constructs, a quit
timer fires, exit code is 0. **Requires a display** (GUI or xvfb-run).

Required when: UI changes, theme changes, mode additions, QSS edits.

### Tier 4 — End-to-end 🔴 not yet implemented

Placeholder. Planned to load a bundled synthetic H5, drop picks in each
mode programmatically, run analysis, assert figure counts.

See `.agent/BACKLOG.md` B-0003.

## Unit + headless tests

```bash
python -m pytest tests/ -q
```

**Must be green** on every push. Current count: 39 tests (5 unit
modules + 1 headless module).

Areas tested:
- USAF lp/mm table formula + canonical values (12 tests).
- GSense Bayer extraction invariants (6 tests).
- Michelson contrast estimators (5 tests).
- DoF focus metrics monotonicity with blur (5 tests).
- FPN math on uniform + noisy inputs (4 tests).
- Headless figure builders build Figures (3 tests).

## Lint

```bash
python -m ruff check mantisanalysis scripts tests
```

Configured conservatively in `pyproject.toml`. Failures here should be
fixed, but are not CI-blocking today.

## Type-check

```bash
python -m mypy mantisanalysis
```

Progressive — annotations exist throughout but the suite is not
type-clean yet. Warnings expected; treat as informational, not blocking.

## CI

GitHub Actions at `.github/workflows/smoke.yml`:

- Tier 1 + `pytest -m "not gui"` on Ubuntu, macOS, Windows, Python
  3.10 / 3.11 / 3.12 / 3.13.
- Tier 2 on Ubuntu (Agg backend; no display needed).
- Tier 3 is **not** wired in CI yet (needs xvfb). Run locally.

## Acceptance checklist (use before claiming a change complete)

- [ ] Tier 1 passes.
- [ ] Tier 2 passes.
- [ ] If UI / theme / mode touched: Tier 3 passes locally.
- [ ] `pytest tests/` is green.
- [ ] Docs updated: whichever of `ARCHITECTURE.md`, `REPO_MAP.md`,
      `WORKFLOWS.md`, `SETUP_AND_RUN.md`, `AGENT_RULES.md`,
      `manifest.yaml` is affected.
- [ ] `CHANGELOG_AGENT.md` has a one-line entry.
- [ ] If a non-trivial decision was made: `DECISIONS.md` entry.
- [ ] If a new risk discovered: `RISKS.md` entry.
- [ ] If remaining work: `BACKLOG.md` entry.
- [ ] Status bar is clean: no "[UNFINISHED]" hacks left behind.
- [ ] Git history is coherent: small, meaningful commits preferred
      over one giant commit.
