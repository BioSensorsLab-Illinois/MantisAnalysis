# ExecPlan — playback-rebuild-v2

> One initiative = one branch (here: `main` per user policy) = one ExecPlan + one Status.

Opened: 2026-04-25
Branch: `main` (per user 2026-04-24 policy: per-milestone commit, push only on consent)
Owner: agent (per user ask, 2026-04-25, "this play module need a seriously
re-plan and developed from ground up again with testing in-mind and
verification in-mind").

## 1. Goal

Replace the deleted Playback module with a smaller, sharper rebuild
that:

- Surfaces real MantisCam H5 recordings from
  `/Users/zz4/Desktop/day5_breast_subject_1/` (33 files, 4 views ×
  multiple exposures × 11 samples).
- Implements the design template at
  [`design/spec.md`](design/spec.md), [`design/wireframes.md`](design/wireframes.md),
  [`design/flows.md`](design/flows.md), and the JSX prototype at
  [`design/playback.jsx`](design/playback.jsx).
- Fixes the v1 failure modes reproduced live before deletion:
  zombie streams after delete, hidden multi-file workflow, monochrome
  channel chips, button clipping at narrow viewports, 1034-line
  Inspector.
- Verifies every milestone by **live render screenshot** — never by
  axe-core or accessibility-skill score (per user 2026-04-25:
  "delete all accessibility workflow and skills").

## 2. Reproduced v1 failures (anchor for M0 tests)

| Symptom | Verified root cause |
|---|---|
| "Frame display always says undecoded" after delete | `playback_session.py::delete_recording` flipped `s.invalidated=True` but never deleted the stream; frame fetch returned HTTP 500. |
| Cannot load multiple H5 recordings inline | Each `+ Sample` / `+ Open` auto-created a separate single-recording stream; merge required opening Stream Builder modal. |
| Cannot reload after delete | Orphan stream from deleted recording occupied the workspace; new recording was orphaned (no auto-stream + no active tab). |
| Monochrome channel chips, hard to read | No per-channel color tokens; 10–11 px text everywhere. |
| Hidden buttons in side panel | Inspector was one 1034-line component rendering 8 stacked sections; clipped at 1024 px. |

## 3. Architecture

Backend: small modules per concern under `mantisanalysis/playback/`:

| Module | Role |
|---|---|
| `h5io.py` | Read MantisCam H5: per-file metadata + per-frame extraction. Strips `network-info`, `os-info`, `hardware-info`, `python-info` from root attrs at the boundary. |
| `library.py` | Durable assets: `Recording`, `DarkFrame`. CRUD only. Parses `sample_N_view_V_exp_S.h5` filename convention. |
| `workspace.py` | User-mutable: `Stream`, `Tab`, `View`. Cascade rules (delete-recording shrinks or removes streams, closes tabs) live here in one place. No `invalidated` flag. |
| `events.py` | SSE event bus for library + workspace + job changes. Frontend diffs on event payloads. |
| `render.py` | Single render entry: `(stream, frame, view) -> PNG bytes`. Used by both preview-PNG and image/video export. WYSIWYG invariant. |
| `export.py` | Image + video export. Calls `render.py`. |
| `api.py` | FastAPI routes (~10 total). Thin. |

Frontend: small files under `web/src/playback/`. Target ~3,500 LOC
total (was 10,279 in v1).

| Path | Role |
|---|---|
| `tokens.ts` | Per-channel colors, icon names, font sizes, spacing, layout proportions. Single source of truth for visual. |
| `api.ts` | Typed fetch wrappers + DTOs. |
| `workspace.ts` | `useWorkspace()` hook; subscribes to SSE; one source of truth. |
| `index.tsx` | ~80-line shell. |
| `components/LibraryRail.tsx` | Left rail with Recordings + Darks, drag-drop, sample/view groups. |
| `components/TabBar.tsx`, `Workspace.tsx`, `ViewerGrid.tsx`, `ViewerCard.tsx`, `Transport.tsx`, `Inspector.tsx` | Workspace chrome. |
| `inspector/ViewTab.tsx`, `DisplayTab.tsx`, `ColorTab.tsx`, `OverlayTab.tsx`, `LabelsTab.tsx`, `ExportTab.tsx` | Tabbed inspector (was 8 stacked sections in v1). |
| `modals/AddFilesDialog.tsx` | The only modal: appears on multi-file drop, asks Append / NewTab / Replace. |

## 4. Visual language (locked at M0; revisable at M3 screenshot review)

Per `design/spec.md` §11 + this initiative's `tokens.ts`:

- **Per-channel color** on every chip + viewer-card top border. HG bands at full saturation, LG bands at reduced sat (same hue, lighter).
- **Dark canvas** in viewer regardless of theme (perceptual choice).
- **3-letter mono badges** in viewer card title bar: RAW, DRK, NRM, LUT, RGB, OVL, LCK, EXP. Color carries severity, code carries meaning.
- **Typography**: 13/15 px body, 10.5 px section headers (uppercase + tracked), monospace for frame indices and timestamps.
- **Layout proportions**: Sources 288 px (240–360), Inspector 368 px (320–440), Timeline 120 px (96–200), per `design/spec.md` §5.4.
- **Icons** on every action button (Lucide names in `tokens.ICONS`).

## 5. Milestones

Each milestone ends in a single commit + a live screenshot you sign off on.

| # | Title | Days | Verified by |
|---|---|---|---|
| **M0** | Wipe v1 + scaffold + 8 failing reproduction tests + Play tile placeholder | 1 | Old files deleted; new module skeleton compiles; `pytest tests/headless/test_playback_v2_backend.py tests/web/test_playback_v2_workflow.py` shows **8 fails, 0 errors** (failing for the right reason); USAF/FPN/DoF still boot; Play tile shows scaffold placeholder. |
| **M1** | Backend library + workspace + cascade + h5io | 2 | All 6 backend tests turn green. Real H5 inspection works against 33-file dataset. SSE event audit. |
| **M2** | Frontend useWorkspace + SSE + LibraryRail | 1.5 | Live screenshot: app boots, library shows real H5s grouped by sample/view/exposure, no console errors. |
| **M3** | Visual tokens + Storybook reviews | 1.5 | I send 12 component screenshots from Storybook. You sign off on tokens or revise. |
| **M4** | TabBar + Workspace + AddFilesDialog flow + ViewerCard + cascade UI | 2 | Live screenshots at 1024/1280/1440/1920 widths. Drop-2-files modal works. Delete cascade closes tab cleanly. 2 Playwright workflow tests turn green. |
| **M5** | Inspector tabs + render pipeline + image export | 2 | Real-data screenshots: HG-R/G/B/NIR channel chips colored, slider responds <100 ms, image export round-trips, 1024-px inspector test turns green. |
| **M6** | Video export + polish + close | 1.5 | mp4 export of one (sample, view) pair; final 5-screenshot review; reviewer agents (no a11y); push consent. |

Total: ~11 working days.

## 6. Risk + rollback

| Risk | Mitigation |
|---|---|
| Deleting v1 leaves the Play tile broken until M2 wires the real shell | M0 ships a placeholder so the rail tile works. The rest of the app (USAF/FPN/DoF) stays functional throughout. |
| Real H5s expose data-model assumptions | M1 acceptance test loads all 33 files; failures rewrite the data model before the frontend lands. |
| Visual taste mismatch | M3 is a Storybook-screenshot review *before* M4 wiring. Iterate tokens, not components. |
| Recordings carry sensitive metadata (network-info, hostname) | h5io.inspect() strips `network-info`, `os-info`, `hardware-info`, `python-info` at the boundary. Test in `test_real_h5_strips_sensitive_root_attrs`. |
| Scope creep | If a feature isn't in M0–M6 above, it's out. Filed as a backlog item. |

No rollback path: this is a clean delete (per user 2026-04-25 "delete all old module immediately to make sure no confusion and chaos"). If a milestone fails, fix forward.

## 7. Final acceptance — STOPPING_CRITERIA for this initiative

- [ ] All 8 reproduction tests green.
- [ ] Tier 1 + 2 + 3 + 4 smoke green.
- [ ] Live screenshots at 1024 / 1280 / 1440 / 1920 widths reviewed.
- [ ] Real H5s from `/Users/zz4/Desktop/day5_breast_subject_1` load, render, multi-load via AddFilesDialog, delete-cascade cleanly.
- [ ] Image + video export round-trip on one real (sample, view) pair.
- [ ] Reviewer agents (planner-architect, react-ui-ux-reviewer, fastapi-backend-reviewer, playwright-verifier, performance-reviewer, risk-skeptic, test-coverage-reviewer, docs-handoff-curator) — **no accessibility-reviewer**.
- [ ] User push consent.
