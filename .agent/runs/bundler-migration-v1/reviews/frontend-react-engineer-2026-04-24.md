# frontend-react-engineer review — bundler-migration-v1 Phase 3

Reviewed: commit `cb3cbaf` (post-commit, pre-close) on 2026-04-24.
Output folded into commit `febb365` (follow-up fixes).

## Scope of review

Verified the ES-module wiring correctness of every migrated file
(shared.jsx, app.jsx, usaf.jsx, fpn.jsx, dof.jsx, analysis.jsx,
isp_settings.jsx). Checked import completeness, export coverage,
circular-import hazards, hook-alias pattern safety under real
React imports, StrictMode re-mount safety.

## Findings

### P0

- **F-1** — `web/src/isp_settings.jsx:33` calls `useSource()` but
  `useSource` was missing from the `import { … } from './shared.jsx'`
  block. Under ES modules this is a hard `ReferenceError` the
  moment the user opens the ISP settings window (Shift+I or ⌘K →
  "ISP settings…"). Tier-0/1/2/3 + the boot Playwright test wouldn't
  trip this — only interaction. **Fixed in `febb365`**: added
  `useSource` to the import block.

### P1 / P2

- **F-2** — `web/src/analysis.jsx:99-114` redefined `channelColor`
  and `paletteColor` locally, duplicating shared.jsx:429-435.
  The build error I hit during Phase 3 forced me to remove them
  from my shared import to dodge the duplicate-declaration, but
  the right move is to delete the local copies. Confirmed
  functionally equivalent: shared's `_BAND_FROM(ch)` handles both
  bare bands and gain-prefixed keys; `_BAND_IDX_FOR_PALETTE` is
  identical to the local `_BAND_IDX`. **Fixed in `febb365`**:
  deleted local copies, restored shared imports.

- **F-3** — `web/src/app.jsx:68` still had `window.FILE_FILTERS =
  FILE_FILTERS;` as a dead bridge. Mode files consume the data via
  the `FileFilterCtx` provider rooted in `<App>` (verified: no file
  reads `window.FILE_FILTERS`). **Fixed in `febb365`**: deleted.

- **F-4** — Hook-alias pattern (`useStateU`, `useStateF`, etc.) is
  cosmetic noise under real ES-module React imports. Not fragile;
  the destructure is pure aliasing. **Deferred** to Phase 4+ cleanup
  (6-file find/replace; not worth the review noise now).

### Confirmed clean (no action)

- `shared.jsx` export list at line 2804 covers every name referenced
  from other files (computed by cross-check script in Phase 3 diff
  discussion).
- Each mode file ends with `export { XMode }; export default XMode;`
  and app.jsx's imports match.
- `main.jsx` StrictMode wrap is safe — spot-checked effect cleanups
  in app.jsx (server bootstrap, mantis:source-evicted listener,
  ispEpoch invalidation) are all re-mount safe.
- `analysis.jsx` imports Plotly + domtoimage as ES-module defaults
  correctly.

## Disposition

P0 fixed in the follow-up commit. P1s fixed except F-4 (cosmetic,
deferred to Phase 4). No P0/P1 remaining at close.
