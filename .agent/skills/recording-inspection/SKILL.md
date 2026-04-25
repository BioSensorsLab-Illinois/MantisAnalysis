---
name: recording-inspection
description: Workflow for the Playback (Recording Inspection) mode — H5 metadata inspection, dark-frame averaging by exposure, multi-file stream building, per-view rendering, and image/video export. Includes the WYSIWYG single-render-entry-point invariant.
when_to_use:
  - editing mantisanalysis/recording.py / dark_frame.py / playback_pipeline.py / playback_export.py / playback_session.py
  - editing /api/playback/* routes in mantisanalysis/server.py
  - editing web/src/playback/* components
  - adding a new dark-averaging strategy
  - adding a new colormap / blend mode / overlay policy
  - changing the eviction event payload (mantis:source-evicted detail.kind)
  - touching the send-to-mode handoff path (recording → STORE LoadedSource)
outputs:
  - unit tests on synthetic H5 (never real recordings — AGENT_RULES rule 11)
  - Tier 3 round-trip test for any /api/playback/* change
  - Tier 4 + Tier 5 Playwright run before claiming the milestone done
  - visual-regression baseline pickup at relevant milestone
related_agents: fastapi-backend-reviewer, react-ui-ux-reviewer, frontend-react-engineer, performance-reviewer, risk-skeptic, accessibility-reviewer
---

# recording-inspection

Skill for any work on the Playback mode introduced by initiative
`recording-inspection-implementation-v1`. The mode lives at:

- Backend: `mantisanalysis/{recording,dark_frame,playback_pipeline,playback_export,playback_session}.py`.
- API: `/api/playback/*` namespace in `mantisanalysis/server.py`.
- Frontend: `web/src/playback/*`.
- Tests: `tests/unit/test_recording_*.py`, `tests/unit/test_dark_frame.py`,
  `tests/unit/test_playback_*.py`, `tests/headless/test_playback_*.py`,
  `tests/web/test_playback_*.py`.

## When to use

Any change that touches H5 inspection, dark averaging, stream building,
per-view rendering, overlay composition, image/video export, or the
send-to-mode handoff. Pair with `h5-io-data-pipeline-change` if the
change also touches `extract.py` / `isp_modes.py` / `image_io.py`.

## Hard constraints (frozen invariants)

1. **Channel-key schema** (AGENT_RULES rule 6) — recordings flow
   through `image_io.extract_with_mode` and (for `rgb_nir`)
   `luminance_from_rgb`. Never coin a new key.
2. **Bayer constants** (AGENT_RULES rule 5) — `extract.ORIGIN`,
   `extract.LOC` are locked.
3. **Analysis-purity** (AGENT_RULES rule 7) — `recording.py`,
   `dark_frame.py`, `playback_pipeline.py`, `playback_export.py`
   import only from `numpy`, `h5py`, `matplotlib.colormaps`,
   `PIL`, optional `imageio`. They MUST NOT import `fastapi` /
   `uvicorn` / `mantisanalysis.server` / `mantisanalysis.session`.
4. **Single render entry point** — both preview-PNG and export-PNG
   call `playback_pipeline.render_frame(stream, view, frame)`.
   WYSIWYG by construction. Byte-equal for image; perceptual diff
   for video (mean per-channel < 5 LSB, max < 20 LSB).
5. **No real H5 in git** (AGENT_RULES rule 11). Use the synthetic
   fixtures in `tests/unit/_h5_fixtures.py`. Real-data smoke runs
   against the user's local dev folder; never committed.

## Standard workflow

1. Read `.agent/runs/recording-inspection-implementation-v1/{ExecPlan,
   API_DESIGN, DATA_MODEL, UI_IMPLEMENTATION_NOTES, TEST_PLAN}.md`.
2. Identify which milestone the change belongs to. If it's a new
   surface, scope as M1+ work; if it's polish, M11.
3. For any backend change: write the unit test first (synthetic
   fixture in `_h5_fixtures.py` if needed); make it green; then
   add the Tier 3 round-trip if a route is involved.
4. For any frontend change: edit the relevant `web/src/playback/*`
   file; run `npm run build` and `npm run lint` clean; then run
   the Playwright workspace test (Tier 5).
5. Capture visual-regression screenshot at the next milestone close.
6. Spawn the relevant reviewer agent serially per milestone close.
7. Update Status.md, HANDOFF.md, and CHANGELOG_AGENT.md.

## Eviction-event contract

`mantis:source-evicted` fires with
`detail = { source_id, kind: 'source' | 'stream' | 'recording' | 'dark' | 'job' }`.
The existing app-shell listener at `web/src/app.tsx` filters on
`kind === 'source' || kind == null` before reloading USAF/FPN/DoF
samples. The Playback reducer subscribes to the same event and
routes by `kind`. Do NOT introduce a new event name.

## Cross-process cancel contract (export jobs)

`ExportJob.cancel_event` is a `multiprocessing.Event` (created via
`multiprocessing.Manager()`) so it crosses
`ProcessPoolExecutor` worker boundaries. Cancel granularity is
"one batch" — already-submitted batches finish; new submissions
are refused after `set()`. Do NOT use `threading.Event`.

## Handoff contract (Send-to-mode)

`POST /api/playback/streams/{id}/handoff/{mode}` sends the **raw
extracted channel dict** (post-dark, pre-display γ/WB/CCM) to the
analysis-mode `STORE`. Display corrections are NOT baked. The
response carries `dark_already_subtracted: true` so the receiving
mode's dark-attach refuses to subtract again. 422 when the
target mode lacks required channel keys (e.g. `bare_dualgain`
→ USAF lacks `Y`).

## Send-to-mode handoff (M11)

`POST /api/playback/streams/{sid}/handoff/{mode}` (mode ∈ {usaf, fpn,
dof}) renders the active frame's raw extracted channel dict and
registers a new `LoadedSource` in the analysis-mode `STORE`. Per
planner-architect P0-2 + risk-skeptic P1-L:

- Body sends `{ frame, view, preserve_dark, name? }`. The `view` is
  the React-side ViewState; the server only reads `dark_on` from it
  to decide whether to apply the matched dark.
- Channels are sent **post-dark, pre-display** — display γ / WB /
  CCM are not baked.
- When dark is applied, the response carries
  `dark_already_subtracted: true`. Receiving USAF/FPN/DoF dark-attach
  paths should refuse to subtract again. The flag also surfaces in
  `LoadedSource.attrs["dark_already_subtracted"] = "true"`.
- USAF requires luminance (`HG-Y` / `Y` / `L`); for ISP modes that
  don't synthesize it (`bare_*`, `polarization_*`), the server
  returns 422 with `code: "W-HANDOFF-NOLUM"`.
- The frontend uses three small `→U / →F / →D` buttons in the
  ViewerCard hover toolbar (`data-action="handoff-{usaf|fpn|dof}"`).
  On success the app switches mode and binds the new source via the
  existing `setSource(...)` hook.

## Presets workflow (M8)

Server-side preset CRUD lives at `/api/playback/presets`. Three
kinds: `view`, `dark`, `ccm`. Each preset has an opaque JSON
payload — the client owns the schema. The Inspector's Presets
section saves the current ViewState as a preset, lists existing
presets, applies one (replays the full ViewState through
`view/update`), and deletes them. Per-kind LRU cap is 64 (oldest
evicted) — see DATA_MODEL §13.

## CCM editor (M8)

The Inspector RGB-grading section embeds a 3×3 numeric grid + live
|det| display. `ccm_on=true` only takes effect when `|det| ≥ 1e-3`
(refusal banner above the grid). "Auto from patches" lets the user
seed ≥3 observed RGB tuples and POST to
`/api/playback/ccm/from-patch` against an X-Rite white target
(`d65_white` / `d50_white` / `d75_white`). The endpoint refuses
under-determined fits (n<3 → identity + stable=False).

## Frame LRU controls (M8)

The Advanced inspector section shows process-global usage and a
slider for the cap (256 MB..8 GB, default 2 GB). Backed by
`PlaybackStore._FrameLRU` — single OrderedDict keyed by
`(stream_id, recording_id, local_frame)` so the cap is shared
across all streams (risk-skeptic P0-C, planner-architect P1-8).

## See also

- `.agent/skills/h5-io-data-pipeline-change/SKILL.md` — the
  upstream H5 / ISP-mode workflow.
- `.agent/skills/visualization-canvas-image-pipeline/SKILL.md` —
  for any color / threshold / blend math.
- `.agent/skills/playwright-e2e-verification/SKILL.md` — for the
  per-milestone Playwright requirement.
- `.agent/skills/independent-review-loop/SKILL.md` — for the
  serial reviewer pass.
