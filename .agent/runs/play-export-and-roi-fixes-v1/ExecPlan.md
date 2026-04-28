# ExecPlan — Play export + ROI fixes v1

Seven user-reported defects in Play mode bundled into one initiative
because the export-quality, multi-file, and progress-bar pieces all
need to share one job-based plumbing layer; the ROI-edit and
TBR-overlay-channel fixes share the canvas pointer-event surface; and
the labels + realtime-validation are isolated bug-fix wins that ship
first to derisk the rest.

## Architecture summary

**Backend (`mantisanalysis/server.py`):**
- `frame_overlay` accepts `labels_*` Query params and calls
  `_maybe_burn_labels` (parity with the channel + RGB routes).
- `export_video` adds CRF / preset / pix_fmt overrides and a
  `mask_polygon` already present.
- New job-based export under `/api/play/exports`:
  - `POST /api/play/exports` body `{ kind: "video"|"video_multi", sources: [...], view: {...}, frame_range, fps, render, codec, crf }` → `{ job_id }`.
  - `GET /api/play/exports/{id}` → `{ status, progress: 0.0-1.0, current_frame, total_frames, error?, started_at, finished_at? }`.
  - `GET /api/play/exports/{id}/result` → file bytes (only after `status=done`).
  - `DELETE /api/play/exports/{id}` → cancel.
- Multi-source video: server iterates the supplied `sources[]` in cascade
  order, opens each via `_must_get`, calls `extract_frame` per frame,
  applies the per-source ISP / overlay / ROI pipeline (already shared
  with `export_video`), and concatenates frames into a single MP4.
- In-memory `JobStore`: `dict[str, ExportJob]` with `Lock`,
  background-thread executor (single worker — exports are CPU-bound and
  the user is one human), TTL cleanup of finished jobs after 1 hour.

**Frontend (`web/src/playback.tsx`):**
- ROI edit mode: new pointer state `roiEdit = { mode: 'idle'|'drag', target: { kind: 'mask'|'tumor'|'bg', vertexIdx: number } | null }`.
  - `pointerdown` on a vertex circle → start drag.
  - `pointermove` while dragging → update polygon vertex in place.
  - `pointerup` → commit + clear drag state.
  - `contextmenu` (right-click) on a vertex → delete it (≥3 vertices remain).
  - `dblclick` on an edge midpoint → insert a vertex at the click position.
  - Hit-test radius = 8 px in screen coords; edge-hit radius = 6 px perpendicular.
- TBR-overlay channel picker: `TbrAnalysisPanel` adds a `<select>` listing the source's available channel keys when the active view is overlay. Default = the channel currently being colormapped on top of the base RGB (read from `view.overlay.channel`).
- `frameOverlayUrl` calls `_appendLabelsQuery` so labels burn into the overlay PNG.
- Frame-range Spinbox onChange stores the raw value; clamp + validate moved to the Export click handler. Inline error message shown on click only.
- `buildVideoUrl` / new `buildExportRequest` forwards the live ISP chain via existing `_appendIspChainQuery` / Pydantic body.
- `max_dim` raised to 4096 (or removed — user wants hi-res).
- New `ExportJobModal` polls `GET /api/play/exports/{id}` every 500 ms, renders a determinate `<progress>` bar with current_frame / total_frames, and a Cancel button hitting `DELETE`. On `done` it auto-fetches the result blob.

**Multi-file scope:** the new modal shows a checkbox list of all
recordings (default: all checked, in cascade order). One MP4 emitted
covering every checked recording's frame range stitched in order. No
per-source MP4 toggle — user said one MP4 only.

## Files touched

### Backend
- `mantisanalysis/server.py` — `frame_overlay` labels; new export job routes; multi-source iteration in the renderer; CRF / preset.
- `mantisanalysis/session.py` — possibly add a `JobStore` accessor; otherwise unchanged.
- New `mantisanalysis/export_jobs.py` — `JobStore`, `ExportJob`, background runner. Pure stdlib (`threading`, `concurrent.futures`).

### Frontend
- `web/src/playback.tsx` — ROI edit pointer state machine; TBR channel picker; labels-on-overlay URL wiring; Spinbox onChange decoupled from validation; new `ExportJobModal` + polling hook; `buildExportRequest` for multi-source body.
- `web/src/playback/sourceModes.ts` — fix `_GAIN_BY_ID` so `overlay_custom` resolves a sensible gain prefix (Bug 7 contributing factor).

### Tests
- `tests/unit/test_export_jobs.py` — job lifecycle (create → progress → done → result → TTL cleanup), cancel, error path, multi-source frame ordering.
- `tests/unit/test_overlay_labels.py` — `frame_overlay` honors `labels_*` params; PNG bytes differ when labels enabled.
- `tests/unit/test_export_multi_source.py` — server emits one MP4 with frames from N sources in cascade order; total frame count = sum of per-source ranges.
- `tests/web/test_play_roi_edit.py` (Tier 4) — Playwright: drag a vertex, right-click delete, double-click insert; polygon updates accordingly; ≥3-vertex floor enforced.
- `tests/web/test_play_export_progress.py` (Tier 4) — Playwright: open export modal, click Export, observe progress bar advance, file downloads.

## Milestone gates

| M | Scope | Gate |
|---|---|---|
| M0 | Initiative scaffold | Status + ExecPlan + reviews/ + screenshots/ folders present. |
| M1 | Bugs 2 + 3 + 4 (labels-overlay, realtime-validation, hi-res-quality) | `frame_overlay` labels test green; Spinbox accepts arbitrary text without clamping mid-edit; export at max_dim=4096 + CRF=18 produces a visibly higher-quality MP4 vs baseline; live verify in browser. |
| M2 | Bug 7 (TBR overlay channel) | TBR signal in overlay matches single-channel TBR for the same ROI ± floating-point noise; `_GAIN_BY_ID` fix lands; channel picker visible + functional in Inspector. |
| M3 | Bug 1 (ROI vertex drag + delete + insert) | Playwright: drag → polygon mutates; right-click → vertex removed; double-click edge → vertex inserted; works for mask, tumor, and bg ROIs. |
| M4 | Bugs 5 + 6 (multi-file export + progress bar) | Multi-source export job: one MP4 with frames from 2+ sources verified in ffprobe; progress bar reaches 100%; cancel mid-render aborts cleanly. |
| M5 | Reviewer pass | `fastapi-backend-reviewer`, `frontend-react-engineer`, `risk-skeptic`, `playwright-verifier`, `react-ui-ux-reviewer`, `performance-reviewer` all spawn; P0/P1 findings resolved. |
| M6 | Close | Smoke 1+2+3+4 green; HANDOFF + CHANGELOG_AGENT updated; STATUS marked `[x]`. |

## Stop conditions

- Any milestone gate fails → fix or revert before next milestone.
- M3 and M4 are independently revertible — if M4 lands but M3 turns out
  to need more work, M4 can ship alone.

## Decision log

- **One MP4 for multi-source** (user) — no per-source toggle; cascade
  order is the recordings array order.
- **Job-based progress** over chunked-transfer-stream — better UX
  (% number, cancel) and the user said "whatever is more stable";
  job pattern survives client disconnect mid-render.
- **TBR overlay channel = user-pick, default to the overlay's
  colormapped channel** (user) — not auto-detect from source mode.
- **ROI edit = full set** drag + right-click-delete + double-click-edge-
  insert (user) — not drag-only.
- **Hi-res default**: max_dim raised to 4096; CRF=18 (visually
  lossless) over default; user can downsize via export modal field.
