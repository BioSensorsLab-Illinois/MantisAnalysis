# risk-skeptic review — bundler-migration-v1 Phase 3 atomic cutover

Reviewed: commit `cb3cbaf` (post-commit, pre-close) on 2026-04-24.
Output folded into commit `febb365` (follow-up fixes).

## Scope of review

Adversarial pass against the atomic CDN→ESM cutover. Looked for
missed `window.X` references, circular imports, PyInstaller /
docs drift, default-mode coverage gaps, and browser-cache
hazards. See original review prompt in
`.agent/runs/bundler-migration-v1/Status.md` reviewer-findings
table.

## Findings

### P0

- **RS-1** — PyInstaller release pipeline ships the "build the
  frontend first" placeholder on every frozen binary. The spec
  bundles `web/` (source tree), not `web/dist/`; `release.yml`
  had no Node setup; `smoke_frozen.py` only checked `<html`,
  which the placeholder satisfies. **Fixed in `febb365`**:
  spec hard-fails without dist, `build.py` runs `npm install &&
  npm run build` before PyInstaller, `smoke_frozen.py` asserts
  `/assets/` reference (not placeholder), `release.yml` installs
  Node 20, `smoke.yml` adds a `tier4-web-smoke` CI job.

- **RS-2** — README + 9 `.agent/` docs claim "no Node / npm",
  "CDN", "Babel standalone" — all stale post Phase 3. First-
  time users following README would hit the placeholder page.
  **Fixed in `febb365`**: sweep of manifest.yaml, REPO_MAP.md,
  PROJECT_BRIEF.md, ARCHITECTURE.md, HANDOFF.md, SETUP_AND_RUN.md,
  TOOLS_AND_SKILLS.md, REFERENCES.md, BACKLOG.md + 2 agent briefs
  + dependency-change skill + README.

### P1

- **RS-3** — Test coverage gap: analysis-modal Plotly path (the
  only consumer of `plotly.js-dist-min`, ~3.5 MB of the 5.35 MB
  bundle) was not exercised by `test_web_boot.py`. A Plotly ESM
  import regression would ship silently. **Fixed in `febb365`**:
  added `test_analysis_modal_plotly_renders` that drives ⌘K →
  "Run analysis" and asserts no console errors during the modal
  lifecycle.

- **RS-4** — Stale Babel/CDN comments in `fpn.jsx` (line 1369-71)
  + `main.jsx` (header). **Fixed in `febb365`**.

### P2

- **RS-5** — Vite `optimizeDeps.include` missing for
  `plotly.js-dist-min`. Dev-mode UX only (production `vite build`
  always pre-bundles). **Deferred** — Phase 4+ optimization, not
  Phase 3 correctness.

- **RS-6** — `main.jsx` didn't guard `document.getElementById('root')`
  against null. **Fixed in `febb365`**: throws a clear error if
  the root element is missing.

### Confirmed clean (no action)

- Circular-import audit: `main → app → {usaf, fpn, dof,
  analysis, isp_settings} → shared` is a strict tree. No cycles.
- `session.py`, `figures.py`, analysis math, API contracts:
  untouched by the cutover; `rg` confirmed no references to
  `web/src` or Plotly in the Python tree.
- Browser cache-busting: Vite's hashed asset names + `NO_CACHE`
  headers + `emptyOutDir: true` make stale-hash risk negligible.

## Disposition

All P0 fixed in the follow-up commit. All P1 fixed. P2-5 tracked
as Phase 4+ deferred (non-blocking). No P0/P1 remaining at
close.
