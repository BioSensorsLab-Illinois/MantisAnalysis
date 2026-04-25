# bundler-migration-v1 — ExecPlan

Opened: 2026-04-24
Branch: `main`
Owner: agent (per user "deep" scope selection on B-0014).

## 1. Goal

Migrate the `web/` frontend from CDN + Babel-standalone to a real
Vite-based ES-module toolchain, with ESLint + Prettier + axe-core +
gradual TypeScript + Storybook on top. Closes B-0014 and unlocks
B-0015 extended (per-mode Playwright) + future visual regression.

This is a **multi-session initiative**. Phase 1 (infrastructure)
ships this session; Phases 2–8 are their own sessions.

## 2. Why

Current frontend (~677 KB of JSX across 7 files) is transpiled in
the browser by Babel-standalone on every page load. Pain points:

- **Slow cold boot** — multi-second blank-page pause before React
  renders.
- **No ES modules** — cross-file references use `window.X = X`
  globals; IDE autocomplete is broken and import graph is invisible.
- **No npm** — can't add axe-core, @axe-core/playwright, Storybook,
  @testing-library/react, TypeScript, or any React ecosystem tool.
- **No tree-shaking** — every file ships whole, even unused
  `export`s.
- **No type-checking** — TypeScript is impossible today.
- **Weak source maps** — Babel-standalone's are OK but not
  production-grade; Playwright failure diffs are harder to read.
- **analysis-page-overhaul-v1 Phase 3 roadblock** — the planned
  `web/src/analysis/` subtree needs real module boundaries to be
  maintainable; `window.*` coordination doesn't scale.

Anthropic's Claude Code best-practices + React 18 upstream docs
converge on Vite as the canonical toolchain in 2026.

## 3. Scope (in, phased)

### Phase 1 — infrastructure (this session)

- `package.json` at repo root with Vite + React 18 + @vitejs/plugin-react.
- `vite.config.js` — React plugin, port 5173, proxy `/api/*` →
  `http://127.0.0.1:8765`.
- `web/src/main.jsx` — minimal ES-module entry that renders a
  hello-world placeholder. Proves the toolchain boots.
- `.gitignore` — add `node_modules/` + `web/dist/`.
- `scripts/doctor.py` extended with Node ≥ 20 + npm checks (WARN
  until Phase 3; promoted to required there).
- `SETUP_AND_RUN.md` — add `npm install` + `npm run dev` + `npm run build` commands.
- `TOOLS_AND_SKILLS.md` — flip Vite from 🔵 to 🟡 (shipped, partial).
- Verify `npm run build` emits `web/dist/` + `npm run dev` serves
  on :5173.
- Tier 0-3 + pytest stay green; CDN path untouched.

### Phase 2 — migrate `web/src/shared.jsx` to ES modules *(PIVOTED 2026-04-24)*

Original: dual-path shared.jsx (`export const X` + `window.X = X`).
Empirical test showed this is infeasible under Babel-standalone's
`<script type="text/babel">` loading.

Shipped alternative: parallel `web/src/shared-esm.js` with a
strategic subset (constants, hooks, API helpers, `SourceCtx`).
Live API shell in `main.jsx`. CDN byte-identical.

### Phase 3 — atomic cutover *(REVISED after empirical Babel-standalone test 2026-04-24)*

**Empirical finding** (2026-04-24, Phase 3a probe): Babel-standalone
silently strips top-level `export` statements (CDN still renders)
BUT throws on top-level `import` statements (CDN breaks
immediately). So **dual-mode shared.jsx is infeasible** without
import-maps + switching every CDN `<script type="text/babel">` to
`<script type="module">` — which is a larger delta than the
bundler migration itself.

This makes Phase 3 **necessarily atomic**: `shared.jsx` + 6 mode
files + `main.jsx` + `web/index.html` + FastAPI mount + tests all
change in one coordinated commit. The CDN path dies the moment
`import` statements enter `shared.jsx`, so there's no partial
"Phase 3a" that keeps both paths green.

Subtask checklist (single atomic commit):

- `shared.jsx`:
    * Replace `const { useState, ... } = React;` with
      `import { useState, ... } from 'react';`.
    * Add `export` before every primitive in the
      `Object.assign(window, ...)` block.
    * Delete the `Object.assign(window, ...)` block itself.
- Each mode file (`app.jsx`, `usaf.jsx`, `fpn.jsx`, `dof.jsx`,
  `analysis.jsx`, `isp_settings.jsx`):
    * `const { useState, ... } = React` → `import { useState, ... } from 'react'`
    * `const { Card, Button, ... } = window` → `import { Card, Button, ... } from './shared.jsx'`
    * `ReactDOM.createRoot` → `import { createRoot } from 'react-dom/client'`
    * `window.Plotly` → `import Plotly from 'plotly.js-dist-min'`
    * `window.domtoimage` → `import domtoimage from 'dom-to-image-more'`
- Install `plotly.js-dist-min` + `dom-to-image-more` via npm.
- `main.jsx` — import + mount the real `<App>` (not
  `<PhaseTwoShell>`); delete Phase 2 shell.
- `web/index.html` — delete CDN script tags. Two options:
    a. Replace its contents with the Vite-built HTML + rewrite
       asset paths. Requires a post-build copy step.
    b. Delete `web/index.html`; rename `web/index-vite.html` →
       `web/index.html`; Vite build emits `web/dist/index.html`.
       FastAPI then serves `web/dist/` as `/`.
- `mantisanalysis/server.py` — mount `web/dist/` when it exists
  (else fall back to `web/` with a "run npm run build first"
  response for the root path).
- `scripts/doctor.py` — promote Node/npm check from WARN to FAIL.
- `tests/web/test_web_boot.py` — verify the boot test's selectors
  + URL still work against the Vite-built page.
- Delete `web/src/shared-esm.js` — Phase 2's parallel file is
  redundant once shared.jsx is the single source of truth.

**Session budget**: 2-3 dedicated sessions. One long session can
probably land the edit wave + a successful build; subsequent
sessions handle reviewer findings + tests + any regressions in
the mode panels' rendering (easy to miss a `window.X` usage
buried deep in a 2600-line file).

Rollback: `git revert` the atomic cutover commit; working tree
returns to the Phase 2 dual-path state.

### Phase 4 — ESLint + Prettier

- `eslint.config.js` — recommended React + React Hooks rules.
- `.prettierrc` — minimal config matching existing style.
- Wire into `doctor.py` + Tier 0.
- Pre-commit hook proposal documented (not installed) in
  `TOOLS_AND_SKILLS.md`.

### Phase 5 — Gradual TypeScript migration

Split into 5a (infrastructure — shipped 2026-04-24) + 5b (file
migrations — multi-session, ongoing).

#### Phase 5a — infrastructure + seed (CLOSED 2026-04-24)

- [x] `tsconfig.json` with `allowJs: true`, `checkJs: false`,
      `strict: true`, `jsx: react-jsx`, `moduleResolution: bundler`,
      `noEmit: true`. Existing `.jsx` files compile unchanged;
      only `.ts`/`.tsx` are strictly type-checked.
- [x] Installed devDeps: `typescript@^5`, `@types/react@^18`,
      `@types/react-dom@^18`, `@types/node@^20`,
      `typescript-eslint@^8`.
- [x] Wired `typescript-eslint` into `eslint.config.js` so both
      `.jsx` and `.tsx` share the React/Hooks rule set. Demoted
      `@typescript-eslint/no-unused-vars` to warn to match the
      core rule.
- [x] New npm script: `typecheck` (`tsc --noEmit`).
- [x] `scripts/check_frontend_lint.py` runs `tsc --noEmit` when
      `node_modules/.bin/tsc` + `tsconfig.json` are present —
      Tier 0 gate extended.
- [x] `scripts/doctor.py::check_frontend_lint_config` now also
      verifies `tsconfig.json` + `typescript` + `typescript-eslint`
      + `@types/react` are present.
- [x] **Seed file**: `web/src/main.jsx` → `web/src/main.tsx`.
      Zero logic change; proves the pipeline end-to-end
      (tsc + eslint + Vite esbuild + Playwright all green).

#### Phase 5b — file migrations (multi-session, ONGOING)

Strategy: move files from the dependency hub outward.

- [ ] `shared.jsx` → `shared.tsx` — 2800-line hub with ~85 exports;
      likely 2-3 sessions. Type every primitive + hook, pay down
      the worst `exhaustive-deps` and `any`-propagating cases
      as we encounter them.
- [ ] `isp_settings.jsx` → `.tsx` — smaller, self-contained.
- [ ] `analysis.jsx` → `.tsx` — big, Plotly-heavy.
- [ ] `usaf.jsx` / `fpn.jsx` / `dof.jsx` → `.tsx` — one at a time.
- [ ] `app.jsx` → `.tsx` — last, once every import is typed.
- [ ] Cleanup: drop `allowJs` + `checkJs: false` once zero `.jsx`
      remain. Promote lint rule set to
      `typescript-eslint/recommendedTypeChecked`.
- [ ] Update `tests/web/` to use TypeScript-aware Playwright types.

### Phase 6 — axe-core integration

- `@axe-core/playwright` in devDependencies.
- New `tests/web/test_accessibility.py` that audits the boot page
  + primary mode panels.
- Wire into `pytest -m web_smoke`.

### Phase 7 — Storybook + initial component stories

- `@storybook/react-vite`.
- Stories for each `shared.jsx` primitive (`Card`, `Button`,
  `Chart`, `Page`, `PlotStylePanel`).
- Stories for analysis modal tab components (once
  analysis-page-overhaul-v1 Phase 4 has extracted them).
- Accessibility + interaction addons wired in.

### Phase 8 — docs + close

- `DECISIONS.md` entry for the final toolchain.
- `REFERENCES.md` update — Vite + Storybook move from "recommended"
  to "shipped".
- Onboarding guide rewritten for the new toolchain.
- Closing review pass + archive.

## 4. Out of scope

- **Rewriting any existing `.jsx` file's UX / behavior** — this is
  purely a toolchain migration. Every file renders byte-identical
  output before and after each phase.
- **analysis-page-overhaul-v1 Phase 3+** — that's paused product
  work with its own initiative.
- **SWC, Parcel, esbuild-only** — Vite chosen; alternatives
  rejected in Decision below.
- **Bundle-size optimization** — first-pass output is "reasonable";
  optimization is its own follow-up.

## 5. Architecture impact

- `web/` becomes a proper npm project. `package.json` at repo root.
- Post-Phase 3: FastAPI serves `web/dist/` in production. Dev mode
  users run `npm run dev` (Vite on :5173) in parallel with the
  Python server (:8765); Vite proxies `/api/*` → Python.
- Module system: `window.*` globals → ES `import/export`.
- `.gitignore`: `node_modules/`, `web/dist/`, `.vite/` cache.

## 6. UI/UX impact

**None per-phase.** Every phase preserves byte-identical UI
rendering. The migration is invisible to the end user (other than
faster cold boot after Phase 3).

## 7. Backend / API impact

- Phase 3: `server.py` may need a dev-mode branch (serve `web/` as
  today, or proxy to Vite). Prod-mode serves `web/dist/`.
- No new routes.

## 8. Data model impact

None.

## 9. Test strategy

- Tier 0-3 + pytest green at every commit.
- Phase 1: add `npm run build` to CI? **No** — CI doesn't run Node
  today; wait until Phase 3 makes it mandatory.
- Phase 2-3: after each file migrates, Playwright web-smoke must
  stay green.
- Phase 6: axe-core audit gates.
- Phase 7: Storybook interaction tests gate major primitives.

## 10. Verification agents

- `planner-architect` — each phase's implementation plan.
- `risk-skeptic` — after Phase 3 (the CDN kill) + Phase 5 (TS).
- `playwright-verifier` — after Phase 3 (new mount path) + Phase 6.
- `test-coverage-reviewer` — at close.
- `docs-handoff-curator` — at close.

## 11. Milestones

- [ ] **Phase 1** — infrastructure (this session).
- [ ] **Phase 2** — shared.jsx to ES modules.
- [ ] **Phase 3** — remaining 6 files + kill CDN.
- [ ] **Phase 4** — ESLint + Prettier.
- [ ] **Phase 5** — TypeScript gradual migration.
- [ ] **Phase 6** — axe-core integration.
- [ ] **Phase 7** — Storybook + initial stories.
- [ ] **Phase 8** — docs + close.

## 12. Acceptance (initiative-level)

- [ ] `npm run dev` + `npm run build` work.
- [ ] All 7 existing `.jsx` files migrated to ES modules or TypeScript.
- [ ] CDN + Babel-standalone path deleted from `web/index.html`.
- [ ] ESLint + Prettier configured + wired into Tier 0.
- [ ] axe-core audit runs under `pytest -m web_smoke`.
- [ ] Storybook renders ≥ 5 component stories with a11y + interaction addons.
- [ ] Tier 0-3 + pytest green at every commit boundary.
- [ ] No user-visible UX regression at any phase.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Node not installed on user's workstation | Low | Doctor.py surfaces WARN; Phase 1 doesn't break existing CDN path. Node 20+ is user's call. |
| W-2 | Vite dev server port 5173 collides with something | Low | Vite config makes it configurable. |
| W-3 | Migrating window.* globals → ES imports in one pass breaks the tree | Medium | Migrate one file at a time with smoke gates (Phases 2-3). |
| W-4 | TypeScript strictness surfaces real bugs we don't want to fix now | Medium | allowJs + checkJs=false during Phase 5 transition; tighten gradually. |
| W-5 | axe-core reveals hard-to-fix a11y issues | Medium | Start in WARN mode; fix or defer findings per severity. |
| W-6 | Storybook + its addons bloat node_modules | Low | node_modules gitignored; only CI pays the cost if we wire it. |
| W-7 | `npm install` output breaks the Python-first doctor flow | Low | Doctor checks Node + runs `npm install --dry-run` style; doesn't require full install. |

## 14. Rollback plan

Each phase is independently reverted. Phase 1 is additive (new
files, CDN path unchanged). Phase 3 is the first destructive phase
(deletes CDN); if rolled back, reinstate the CDN script tags in
`web/index.html`.

## 15. Decisions

- **(2026-04-24) Vite over esbuild / SWC / Parcel.** Vite is the
  industry standard for React in 2026; ships dev server + prod
  bundler in one; Storybook integrates natively via
  `@storybook/react-vite`; community mass + Anthropic's own
  guidance.
- **(2026-04-24) Node ≥ 20 floor.** Current LTS; Vite 5/6 requires
  Node 18+ but 20 is the clean long-term pick.
- **(2026-04-24) Gradual TypeScript (Phase 5), not immediate.** The
  migration is already a lot; TS would balloon the surface. Allow
  `.jsx` and `.tsx` side-by-side during transition.
- **(2026-04-24) Keep CDN path through Phase 2; kill in Phase 3.**
  Each migrated `.jsx` file first goes ES-module-compatible while
  keeping `window.*` fallbacks, so both rendering paths still work.
  Phase 3 deletes the CDN scripts once every file has been
  migrated.
- **(2026-04-24) `package.json` at repo root, not under `web/`.**
  Standard convention for React projects; keeps npm scripts
  discoverable; FastAPI's `WEB_DIR` stays unchanged.
