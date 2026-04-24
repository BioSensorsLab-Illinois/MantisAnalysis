# ExecPlan — gui-rewrite-v1

> One initiative = one branch = one ExecPlan + one Status.

<!-- qt-allowed: Historical — this initiative planned the PyQt→FastAPI+React rewrite (D-0009). References to the Qt era preserved as archaeology. -->

## Goal

Introduce a new web-based GUI stack (React 18 + Babel standalone, single-page, CDN-loaded) alongside the existing PyQt desktop app, seeded from the `MantisAnalysis Suite` hi-fi design handoff bundle produced in Claude Design. The new GUI lives at `web/` and runs as a static prototype today.

## Why

User directive on 2026-04-22: *"rewrite the entire software GUI with new GUI stack and tech"*, pointing to design handoff `https://api.anthropic.com/v1/design/h/sRqIo_XUO3eQLBfY1bw3sg?open_file=index.html` and asking me to implement `index.html`.

The design is a complete self-contained React prototype — three modes (USAF / FPN / DoF), analysis modal, command palette, ⌘K, tweaks panel, theme, DoF reference-length calibration, ISP card, rotation-aware labels, rulers, zoom/pan, etc. It is scaffolded on synthetic procedural imagery; no backend is required to render and interact with it.

Context for future agents: this lays the keel for eventually replacing the 1936-LoC `scripts/pick_lines_gui.py` with a web frontend + Python analysis server. That wiring is **out of scope for this initiative**.

## Scope (what's in)

- Copy the 6 design files into `web/` verbatim:
  - `web/index.html`
  - `web/src/{shared,usaf,fpn,dof,analysis,app}.jsx`
- Document the new layer in `.agent/ARCHITECTURE.md` + `.agent/REPO_MAP.md` + `README.md`.
- Record the architectural choice in `DECISIONS.md` (D-0008).
- Record follow-ups in `BACKLOG.md` (wire to real analysis, bundle, dev server, tests).
- Leave the existing PyQt app untouched — no imports or behaviors change.
- Run Tier 1 + Tier 2 smoke to prove the Python side is unaffected.
- Visually sanity-check the web build in a browser if feasible on this host.

## Out of scope (deliberately deferred)

- **Connecting the web UI to real Python analysis** — the prototype uses synthetic `makeUSAFImage` / `makeFPNImage` / `makeDoFImage` procedural generators; real H5 load, Bayer extraction, USAF / FPN / DoF math currently live in `mantisanalysis/*.py` and are reachable only from the PyQt app. Wiring paths (FastAPI server, WebSocket, pyodide, Electron, Tauri, etc.) get their own initiative. Recorded as backlog B-0013.
- **Retiring the PyQt GUI** — keep working; any removal needs a separate decision and migration.
- **Build tooling** — right now the page loads React + Babel from CDN and transpiles in-browser. Vite / esbuild / bundling is backlog B-0014.
- **Automated tests for the web side** — Playwright / Vitest setup is backlog B-0015.
- **Design-system audit** — the prototype's local palette/spacing/fonts are taken as-given; pixel-tuning a separate pass.
- **Offline/PWA behavior, service worker, auth** — none of these apply to a research tool; not pursued.

## Milestones

- [x] **M1 — Files landed** — `web/index.html` + 6 JSX files present, verbatim from the design bundle.
- [x] **M2 — Docs updated** — ARCHITECTURE / REPO_MAP / DECISIONS / CHANGELOG_AGENT / BACKLOG / README reflect the new layer.
- [ ] **M3 — Smoke green** — Tier 1 + Tier 2 + pytest all pass (proves Python side untouched).
- [ ] **M4 — Browser boot verified** — `open web/index.html` (or an equivalent static server command) renders the TopBar, ModeRail, USAF canvas, sidebars without JS console errors. This is visual only, not a blocking gate.

## Decision Log

- 2026-04-22 — **web/ at repo root, not under `mantisanalysis/`**: the package is a Python analysis library; Python code discoverability should not be diluted by a web tree. `web/` is idiomatic and keeps the Python package pure.
- 2026-04-22 — **Prototype landed verbatim, not rewritten into a different framework**: the design README says "recreate pixel-perfectly in whatever tech fits the target codebase." Target codebase currently has no frontend stack, so verbatim React is the smallest move that honors the design intent. Rewriting to another stack (Vue, Svelte, vanilla) now would be speculative churn.
- 2026-04-22 — **No bundler today**: React + Babel standalone from CDN boots without toolchain. Adding Vite/esbuild later (B-0014) is a clean, reversible upgrade.
- 2026-04-22 — **PyQt app preserved, not replaced**: user said "rewrite the GUI"; replacing the working analysis UI before the web side is wired to actual analysis would regress capability. Parallel coexistence is the safe path.

## Surprises & Discoveries

- 2026-04-22 — Design bundle was delivered as a gzipped tarball through WebFetch's 15-minute cache hole rather than a parseable model response. Extracted via `tar -xzf` from the saved binary. Bundle README is clear: read chats first, read `index.html` top-to-bottom, follow imports.
- 2026-04-22 — Chat log shows the design went through 8 iterations with the user (rebrand to MantisAnalysis, reticle+prism logo, DoF reference-length calibration, wider sidebars, responsive grid, ISP card, rotation-aware labels, etc.). All of that is in the files we landed.

## Outcomes & Retrospective

Pending. Will fill at close.

<!-- /qt-allowed -->
