# HANDOFF — current live state pointer

Last updated: **2026-04-23**, end of `backlog-cleanup-v1` (post-trio
backlog fully drained; committable).

## Current state of the working tree

- Branch: `main`.
- VCS state: **large multi-session refactor uncommitted** on `main`.
  B-0010 (initial commit + push) is the only open gate left from this
  cleanup sweep and awaits explicit user consent.

## What just shipped (backlog-cleanup-v1)

Single session that swept the open backlog after the USAF/FPN/DoF
rewrite trio closed:

- **B-0016 + B-0005 (R-0007)** — new `mantisanalysis/plotting.py` owns
  `_color` / `_ch` / `_style_axes` + `CHANNEL_COLORS`. Deleted dead
  `open_*_window` Qt factories and their entire tab / draw / theme
  helper chain. −~1500 LoC across three render files; R-0007
  cross-module coupling closed.
- **B-0020** — DoF analysis modal gets a `Unit` segmented control
  (Auto / px / µm / mm / cm) + helpers that fall back to px with a
  "calibration missing" hint when a physical unit is picked on an
  uncalibrated line.
- **B-0021** — DoF target-tilt correction. `Target tilt (°)` slider on
  the picker (persisted at `dof/tiltAngleDeg`, disabled until a
  calibration reference is set) propagates through the run payload as
  `tilt_angle_deg`; the modal shows a live °-input + applies
  `1/cos(θ·π/180)` to every peak / σ / FWHM / DoF width, with a
  header suffix making pre/post-correction numbers unambiguous. CSV
  + JSON exports carry the raw-px values and the active tilt.
- **B-0019** — every hardcoded `fontSize={N}` / `strokeWidth={N}` /
  `fontFamily="ui-monospace,..."` literal in `web/src/analysis.jsx`
  replaced with `scaled(N, style)` / `style.*` / cascade-from-modal-
  root fontFamily. Renamed `MiniMTFChart`'s draw-style prop from
  `style` → `drawStyle` to disambiguate.
- **B-0015** — Playwright smoke scaffolded + passing locally at
  `tests/web/test_web_boot.py`. Opt-in extras
  `[web-smoke]` + `web_smoke` pytest marker.
- **B-0018** — documented the required real-sample validation captures
  in `docs/validation/README.md`; still BLOCKED on H5 recordings.
- **B-0011** — deleted stale `requirements.txt` (was listing PySide6);
  `pyproject.toml` is now the only dependency source.
- **Legacy sweep** — B-0001 / B-0002 / B-0003 / B-0004 / B-0008 /
  B-0009 / B-0013 closed in BACKLOG.md as obsolete or already-done.
- **D-0014** added for the dead-Qt delete + `plotting.py` hoist.

## Smoke status, last verified 2026-04-23

- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written to `outputs/smoke/`)
- ✅ Tier 3 — PASS (FastAPI TestClient exercises health / sample /
  thumbnail / USAF measure / FPN compute / DoF compute / analyze)
- ✅ pytest — 40/40 green (including the new Playwright smoke at
  `tests/web/test_web_boot.py`)

## Quick verification for the next agent

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest               # 40 tests including tests/web
python -m mantisanalysis --no-browser   # real uvicorn boot
curl http://127.0.0.1:8765/api/health
```

## Where to pick up next

1. **B-0010** — initial commit + `git push -u origin main`. This is
   the explicit user-consent gate from the previous handoff and is
   still the next action after this session's backlog sweep.
2. **B-0018** — real-sample validation: needs real H5 captures. Staging
   area is `docs/validation/` per its README.
3. **B-0015 extended** — per-mode interaction tests + CI gating of the
   Playwright smoke (installing chromium in CI is ~300 MB).
4. **B-0014** — adopt a bundler for `web/` (Vite/esbuild) if the CDN
   Babel boot becomes a bottleneck.
5. **B-0006, B-0007, B-0012** — untouched legacy items that stayed
   valid after Qt removal (legacy Workflow A CLI smoke, rotate-clears-
   picks warning, onboarding helper script).

## Known dirty files

Everything in `mantisanalysis/` (incl. new `plotting.py`, shrunken
`*_render.py`), `web/src/analysis.jsx`, `web/src/dof.jsx`, `tests/web/`,
`docs/validation/`, `pyproject.toml`, `.agent/BACKLOG.md`,
`.agent/CHANGELOG_AGENT.md`, `.agent/DECISIONS.md`,
`.agent/ARCHITECTURE.md`, `.agent/REPO_MAP.md`, `.agent/HANDOFF.md`,
and the `.agent/runs/backlog-cleanup-v1/` initiative folder. Deleted:
`requirements.txt`. `git status -sb` will show the full list.

## Active initiative

`.agent/runs/backlog-cleanup-v1/` — post-trio backlog drain. All
milestones ticked except the final commit (B-0010) which is up to the
user.

Preceded by:
- `.agent/runs/analysis-polish-v1/` — publication-grade plotStyle
  framework (infrastructure that this session wired up across every
  chart component).
- `.agent/runs/dof-rewrite-v1/` — DoF mode brought to USAF/FPN parity.
- `.agent/runs/fpn-rewrite-v1/` — FPN mode parity + EMVA extras.
- `.agent/runs/gui-rewrite-v1/` — original PyQt→web refactor (D-0009).
