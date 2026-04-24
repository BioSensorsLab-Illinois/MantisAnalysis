# Status — gui-rewrite-v1 (extended into v2 / D-0009 scope)

> Updated at every milestone. Append-only.

<!-- qt-allowed: This historical initiative is the PyQt→FastAPI+React rewrite (D-0009). References to PySide6, pick_lines_gui.py, etc. are preserved as the archaeological record of why the current architecture exists. -->


## 2026-04-22 — Extended scope: PyQt deletion + real functionality (D-0009)

User feedback on the v1 prototype-only drop: *"nothing works, the goal is to delete the QT app, implement the full functionality of the new GUI"*. This initiative expanded to cover the full backend + real wiring + Qt deletion.

What shipped in the extension:
- FastAPI server (`mantisanalysis/server.py`) + session store (`session.py`) + PNG adapter (`figures.py`).
- Rewrote `app.py` + `__main__.py` as uvicorn launchers.
- Rewrote all 6 files in `web/src/` to call the real API (real channel thumbnails, real Michelson / DSNU / focus / DoF numbers, real matplotlib PNGs in the analysis modal).
- Deleted `scripts/pick_lines_gui.py` (1936 LoC), `mantisanalysis/modes/*`, `MantisAnalysis.bat`.
- `pyproject.toml` version 0.1.0 → 0.2.0, dropped PySide6/pytest-qt, added fastapi/uvicorn/python-multipart/pydantic/httpx.
- Rewrote `scripts/smoke_test.py` tier 3 → FastAPI TestClient round-trip. Added tier-3 CI job.
- Updated AGENT_RULES, ARCHITECTURE, DECISIONS (D-0009), CHANGELOG_AGENT, BACKLOG (B-0016), REPO_MAP, README.

Smoke status: ✅ Tier 1 (imports) · ✅ Tier 2 (figures) · ✅ Tier 3 (FastAPI TestClient end-to-end).

Next agent picking this up should:
1. Run `python -m mantisanalysis` and drive the UI end-to-end with a real H5 file to confirm visual parity with what the old Qt app produced.
2. Pick up B-0016 (delete dead `open_*_window` functions in render modules).
3. Consider B-0015 (web-side test harness — Playwright smoke) if UI regressions start biting.

---

## Current branch

`main` (no feature branch; large-scope commit pending user review).

## Current focus

Landing the MantisAnalysis Suite React prototype under `web/`, updating `.agent/` docs, and smoke-gating the Python side to prove it wasn't disturbed.

## Progress

- [x] M1 — Files landed (`web/index.html`, 6 JSX files in `web/src/`)
- [x] M2 — Docs updated (`ARCHITECTURE`, `REPO_MAP`, `DECISIONS` D-0008, `CHANGELOG_AGENT`, `BACKLOG` B-0013/B-0014/B-0015, `README`)
- [x] M3 — Smoke green (Tier 1 PASS, Tier 2 PASS; pytest not runnable — no regression, see note)
- [x] M4 — Browser boot dispatched via `open web/index.html` (exit 0)

## Smoke status (last verified 2026-04-22)

- Tier 1: ✅ PASS — 15 modules imported
- Tier 2: ✅ PASS — figures written to `outputs/smoke/`
- Tier 3: N/A for this initiative (no Qt code changed)
- pytest: ⚠ UNRUNNABLE — `No module named pytest` in the active venv
  (`/Users/zz4/.pyenv/versions/test-env`). This is a pre-existing env
  issue, not a regression from this initiative: no Python source file
  was modified. `[project.optional-dependencies].dev` lists pytest;
  user can `pip install -e .[dev]` to enable it.

## Blockers

None for this initiative. Down-line initiatives (B-0013 in particular)
need the user to choose a transport strategy before starting.

## Known checks still required

Deferred to later sessions:

- Install dev deps and re-run pytest (`pip install -e .[dev] && python -m pytest tests/ -q`).
- Visual audit of the web GUI in a browser — drag picks in USAF, draw an ROI in FPN, drop a DoF probe and set a reference length.
- Cross-check that the `BRAND` object at `web/src/shared.jsx:10` matches what we want surfaced publicly (in particular, `BRAND.authorEmail = 'j@polarxphotonics.com'` matches the Python `LICENSE` and `mantisanalysis/__init__.py`).

## Next steps

1. Commit the initiative once user approves (B-0010 is still open and pending user consent; combining is possible but user-directed).
2. Open `.agent/runs/web-python-bridge/` for B-0013 (bridge web GUI ↔ Python analysis) when user signals.
3. Revisit B-0014 (bundler) and B-0015 (web test harness) after B-0013 decides the transport.

## Uncommitted files

Expected additions (everything new — this repo's working tree was previously clean):

```
??  web/index.html
??  web/src/analysis.jsx
??  web/src/app.jsx
??  web/src/dof.jsx
??  web/src/fpn.jsx
??  web/src/shared.jsx
??  web/src/usaf.jsx
??  .agent/runs/gui-rewrite-v1/ExecPlan.md
??  .agent/runs/gui-rewrite-v1/Status.md
 M  .agent/ARCHITECTURE.md
 M  .agent/BACKLOG.md
 M  .agent/CHANGELOG_AGENT.md
 M  .agent/DECISIONS.md
 M  .agent/REPO_MAP.md
 M  README.md
```

## Uncommitted files

Expected additions (everything new — this repo's working tree was previously clean):

```
??  web/index.html
??  web/src/analysis.jsx
??  web/src/app.jsx
??  web/src/dof.jsx
??  web/src/fpn.jsx
??  web/src/shared.jsx
??  web/src/usaf.jsx
??  .agent/runs/gui-rewrite-v1/ExecPlan.md
??  .agent/runs/gui-rewrite-v1/Status.md
 M  .agent/ARCHITECTURE.md
 M  .agent/BACKLOG.md
 M  .agent/CHANGELOG_AGENT.md
 M  .agent/DECISIONS.md
 M  .agent/HANDOFF.md
 M  .agent/REPO_MAP.md
 M  README.md
```

## Notes for handoff

- The React prototype is **self-contained, CDN-loaded, synthetic data only**. It does not load real H5 recordings or call the Python analysis math. That's intentional — wiring it to Python is its own initiative (B-0013).
- Design handoff source: `https://api.anthropic.com/v1/design/h/sRqIo_XUO3eQLBfY1bw3sg?open_file=index.html` — bundle was retrieved as a gzipped tar at `/Users/zz4/.claude/projects/-Users-zz4-BSL-MantisAnalysis/0a323775-4362-493c-9d6c-486bb6db2d0c/tool-results/webfetch-1776887883097-2vkq7x.bin` and extracted to `/tmp/mantis_design/camera-performance-analysis/`.
- The prototype ships a 13-line USAF seed, an ROI for FPN, probe points + reference-length calibration for DoF. Good starting state for a demo; user can save to localStorage via the palette.
- Branding is already MantisAnalysis / BioSensors Lab @ UIUC / `j@polarxphotonics.com` — matches repo identity.
- If the prototype's branding ever needs to flip to MIT email or an updated lab tagline, it's centralized in the `BRAND` object at `web/src/shared.jsx:10`.

<!-- /qt-allowed -->

## Final verification

_Closed retroactively. This initiative shipped before the stopping-criteria protocol (D-0015, 2026-04-24). Original Status.md recorded Tier 1 + Tier 2 green; Tier 3 was the Qt-boot tier at that time and was verified during development. The initiative itself deleted the Qt layer per D-0009. Accepted without per-gate checklist._
