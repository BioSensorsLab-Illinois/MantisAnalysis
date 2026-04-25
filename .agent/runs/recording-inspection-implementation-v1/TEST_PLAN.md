# TEST_PLAN — recording-inspection-implementation-v1

> Companion to ExecPlan / DATA_MODEL / API_DESIGN / UI_IMPLEMENTATION_NOTES.
> Authoritative for which tests are written, where they live, and which
> tier they gate.

Last updated: 2026-04-24

## 0. Coverage matrix

| Layer | Concern | Test file(s) | Tier |
|---|---|---|---|
| H5 inspection | Synthetic H5 → metadata, channel set, exposure, timestamps, fallbacks | `tests/unit/test_recording_inspect.py` | 1, 2 |
| Dark frame | Averaging math, exposure matching, shape-mismatch rejection | `tests/unit/test_dark_frame.py` | 1, 2 |
| Stream builder | Multi-file ordering, continuity, gap/overlap/mismatch, quarantine, frame mapping | `tests/unit/test_playback_stream.py` | 1, 2 |
| Pipeline | Dark / gain / offset / normalize / threshold / colormap / RGB / overlay numerics | `tests/unit/test_playback_pipeline.py` | 1, 2 |
| Export | Image round-trip, tiled composition, label burn-in, video metadata | `tests/unit/test_playback_export.py` | 1, 2 |
| Server API | Inspect, upload, build_stream, frame.png, exports/image, exports/video lifecycle | `tests/headless/test_playback_api.py` (TestClient) | 3 |
| Render parity | Preview vs export render byte-equality | `tests/headless/test_playback_render.py` | 2 |
| Browser smoke | Mode tile present; empty state; modal opens | `tests/web/test_playback_boot.py` | 4 |
| Browser feature | Load sample → add view → scrub → export image | `tests/web/test_playback_workspace.py` | 5 |
| A11y | Keyboard, axe-core, contrast, labels | `tests/web/test_accessibility.py` (extension) | 7 |
| Performance | Preview latency, export throughput (parallelized), scrub responsiveness | manual + `tests/web/test_playback_perf.py` | 8 |
| Visual regression | Pixel-deltable parity per wireframe surface | `tests/web/test_playback_visual.py` (Playwright `to_have_screenshot`) | 6 |
| CCM | Solver, det-stability guard, round-trip | `tests/unit/test_ccm.py` + `tests/web/test_playback_workspace.py::test_ccm_apply` | 1, 5 |
| Send-to-mode | Handoff round-trips channel schema | `tests/unit/test_playback_handoff.py` + `tests/web/test_playback_handoff.py` | 3, 5 |
| Real-data manual | `/Users/zz4/Desktop/day5_breast_subject_1` end-to-end | manual checklist in Status.md | n/a |

## 1. Synthetic H5 fixtures

We do not commit any real recordings. Two helpers in
`tests/unit/_h5_fixtures.py` build deterministic synthetic H5s for
every test that needs them. Each returns the path so tests can
parametrize on small / large / canonical / non-canonical layouts.

```python
def write_synthetic_recording(path: Path, *,
                              n_frames: int = 8,
                              h: int = 32, w: int = 64,
                              exposure_us: int = 20_000,
                              fps: float = 30.0,
                              ts_start_s: float = 0.0,
                              variant: str = 'canonical',
                              ) -> None:
    """Build a Mantis-style dual-gain H5 with tagged pixel values.

    variant:
      'canonical'      — /camera/{frames,timestamp,integration-time}
      'no-timestamp'   — drop /camera/timestamp → triggers W-META-TS
      'no-exposure'    — drop /camera/integration-time
      'top-level'      — frames at top-level instead of /camera/
      'single-frame'   — 2-D dataset (one frame), no leading axis
      'four-d'         — (N, H, W, 1) — legacy shape
      'empty'          — n_frames=0
    """

def write_synthetic_dark(path: Path, *,
                         n_frames: int = 16,
                         h: int = 32, w: int = 64,
                         exposure_us: int = 20_000,
                         pedestal: int = 140,
                         shot_noise: int = 12,
                         ) -> None:
    """Build a dark stack with a known mean (pedestal ± noise) per pixel."""
```

Each frame's pixel value encodes `(frame_idx, row, col)` so tests can
verify "the channel I extracted came from the frame I asked for."

## 2. Tier 1 — imports

Add to `scripts/smoke_test.py::tier1` modules list:

```python
"mantisanalysis.recording",
"mantisanalysis.dark_frame",
"mantisanalysis.playback_pipeline",
"mantisanalysis.playback_export",
"mantisanalysis.playback_session",
```

Verifies every new module imports cleanly (no syntax errors, no
missing deps in non-debug paths). ~1 s.

## 3. Tier 2 — headless figures

Extend `tier2`:

1. Build a synthetic 8-frame H5 in tmpdir.
2. `inspect_recording(path)` → assert `frame_count == 8`,
   `channels` superset of `{HG-R, HG-G, HG-B, HG-NIR}`.
3. `extract_frame(meta, 0, ...)` → assert dict has those channels,
   each `(8, 16)` shape (post-Bayer extraction).
4. Build a fake `MasterDark` with zero pixels.
5. Build a fake `ViewState` with `view.colormap='inferno'`,
   `view.overlay_on=True`.
6. `playback_pipeline.render_frame(channels, view, dark)` → assert
   uint8 (H, W, 3) shape and write `outputs/smoke/playback_overlay.png`.
7. `playback_export.export_image(stream_handle_stub, frame=0,
   views=[view], compose='contactSheet')` → write
   `outputs/smoke/playback_export.png`. Asserts file is non-empty
   PNG.

Wall: ~2 s.

## 4. Tier 3 — FastAPI round-trip

Extend `tier3` (in-process TestClient):

```python
# Existing checks remain.

# 1. /api/playback/health
r = c.get("/api/playback/health"); assert r.json()["ok"]

# 2. /api/playback/recordings/load-sample (test-only endpoint)
r = c.post("/api/playback/recordings/load-sample"); rid = r.json()["recording_id"]

# 3. /api/playback/streams
r = c.post("/api/playback/streams", json={
    "recording_ids": [rid],
    "continuity_threshold_s": 1.0,
    "isp_mode_id": "rgb_nir",
}); sid = r.json()["stream_id"]

# 4. /api/playback/streams/{sid}/frame/0.png?...
r = c.get(f"/api/playback/streams/{sid}/frame/0.png"
          "?channel=HG-G&colormap=viridis&low=0&high=2000")
assert r.status_code == 200
assert r.headers["content-type"] == "image/png"
assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

# 5. /api/playback/exports/image
r = c.post("/api/playback/exports/image", json={
    "stream_id": sid, "frame": 0, "compose": "single",
    "format": "png", "include_labels": False, "include_badges": False,
    "views": [{ "view_id": "v1", "name": "test", "type": "single",
                "channel": "HG-G", "colormap": "viridis",
                "low": 0, "high": 2000, ... }],
})
assert r.status_code == 200
assert r.headers["content-type"] == "image/png"
```

Wall: ~3 s.

The route handlers run inside the test process so `STORE` and
`PLAYBACK_STORE` are reset between Tier 3 invocations. We don't
need a separate uvicorn process.

## 5. Tier 4 — Browser smoke

`tests/web/test_playback_boot.py`:

- Boot the FastAPI server (existing `web_server` fixture).
- Set `MANTIS_PLAYBACK_TEST=1` so the test endpoints are mounted.
- Load `/`, switch to Playback via the rail.
- Assert mode tile labeled "Playback" exists.
- Click it.
- Assert empty-state CTA "Open recording" is visible.
- Click "Open recording"-button-with-test-mode-fallback (the test
  endpoint button) → wait for SourcesPanel to show one FilePill.
- Assert no console errors (existing pattern).

Wall: ~4 s above the existing boot test.

## 6. Tier 5 — Browser feature

`tests/web/test_playback_workspace.py`:

Multi-flow Playwright test, one test function per persona flow from
`flows.md`:

1. **F1 (any persona)** — Mode switching by `4` keyboard.
2. **F2 (Marcus)** — Load one synthetic recording → single-view
   mode → view renders.
3. **F4 (Priya)** — Load three synthetic recordings via the test
   endpoint → Stream Builder auto-opens → Apply.
4. **F6 (Lan)** — Layout 2×2 → all four views render with different
   channels.
5. **F7 (Marcus)** — NIR view selected → drag low slider → view PNG
   url changes; preview reloads.
6. **F8 (Marcus)** — Open Overlay Builder → set overlay → Apply →
   ViewerCard shows OVL badge.
7. **F10 (Lan)** — Lock view 1 to current frame → scrub timeline →
   view 1 stays, others move.
8. **F11 (Priya)** — Open Export Image modal → tiled compose →
   Export → assert downloaded PNG (via Playwright download API)
   has expected dimensions.

For each: assert `count(console.error) == 0`, no failed network
requests, screenshot saved to
`.agent/runs/recording-inspection-implementation-v1/screenshots/`.

Wall: ~30–60 s for the full file.

## 7. Tier 7 — Accessibility

Extend `tests/web/test_accessibility.py`:

```python
@pytest.mark.web_smoke
def test_playback_a11y_baseline_zero(web_server: str) -> None:
    # Navigate to Playback workspace with synthetic stream loaded.
    # Run axe-core on workspace + stream-builder modal + inspector.
    # Assert critical_count == 0 and serious_count == 0.
```

Plus manual checklist (Status.md):

- Tab order: ModeRail → StreamHeader → SourcesPanel → ViewerGrid
  → Inspector → TimelineStrip → StatusBar.
- `Esc` in any modal returns focus to the trigger.
- Slider values announced on change (existing primitive does this).
- ViewerCard `aria-selected="true"` when selected.
- Color contrast: every text-on-background pair ≥ AA per
  spec.md §11.8 mapping.

## 8. Tier 8 — Performance

`tests/web/test_playback_perf.py` (Playwright + manual):

Automated:

- Load a synthetic 4 000-frame stream (test endpoint).
- Set layout to 2×2.
- Programmatically scrub frame from 0 → 3999 in 100-frame steps.
- Assert each preview image's load time < 200 ms (P95) via
  `Performance.getEntriesByType('resource')`.
- Assert no React re-render storm: instrument the reducer to count
  dispatches; expect ≤ 100 dispatches per scrub of 100 frames
  (one per scrub event + occasional view updates).

Manual (recorded in `Status.md` performance section):

- Time export of a 1-second 30-fps tiled 2×2 video at 1080p.
  Assert wall-clock < 30 s (`fps_scale ≤ 1.0`).
- RAM peak during the same export: assert < 8 GB
  via `psutil` snapshot.
- Frame-LRU hit rate during scrubbing: ≥ 50% for backward-scrubs.

## 9. Unit test specs

### 9.1 `tests/unit/test_recording_inspect.py`

```python
def test_canonical_recording_meta_complete(tmp_path):
    ...  # frame_count, channels, exposure, timestamps populated

def test_no_timestamp_emits_warning(tmp_path):
    ...  # variant='no-timestamp' → W-META-TS in warnings

def test_no_exposure_emits_warning(tmp_path):
    ...

def test_top_level_frames_dataset_emits_W_META_PATH(tmp_path):
    ...

def test_single_frame_layout(tmp_path):
    ...  # variant='single-frame' → frame_count=1, W-META-SINGLE-FRAME

def test_legacy_4d_layout_silently_handled(tmp_path):
    ...  # variant='four-d' → frame_count=N, no warning

def test_empty_recording_returns_error(tmp_path):
    ...  # variant='empty' → errors=[E-LAYOUT]

def test_extract_frame_returns_correct_pixel(tmp_path):
    # Pixel values are tagged (frame_idx*1e6 + row*1e3 + col).
    # Verify extraction picks the right frame.
    ...

def test_channel_keys_match_frozen_schema(tmp_path):
    ...  # exact set match against the canonical key set
```

### 9.2 `tests/unit/test_dark_frame.py`

```python
def test_average_dark_returns_expected_pedestal(tmp_path):
    # Synthetic dark with pedestal=140 ± 12 → avg ≈ 140
    ...

def test_average_dark_respects_max_frames(tmp_path):
    # 32-frame stack with max_frames=8 → frames_averaged=8
    ...

def test_average_dark_warns_on_short_stack(tmp_path):
    # n_frames < 4 → W-DARK-SHORT
    ...

def test_match_dark_exact_match():
    ...  # exposure_us=20000 in pool → that dark, delta_pct=0.0

def test_match_dark_within_tolerance():
    ...  # 22000 vs 20000 with tol=0.10 → match, delta_pct=0.10

def test_match_dark_outside_tolerance_returns_none():
    ...  # 30000 vs 20000 with tol=0.10 → None, alternatives populated

def test_match_dark_ambiguous_picks_most_recent():
    # two darks at the same exposure → most recent wins
    ...
```

### 9.3 `tests/unit/test_playback_stream.py`

```python
def test_single_recording_stream_total_frames():
    ...

def test_multi_recording_continuous_stream():
    # 3×1200-frame recordings, no gap → total=3600, no warnings
    ...

def test_gap_detected_above_threshold():
    # 0.8 s gap, threshold 0.5 s → W-GAP, gap_count=1
    ...

def test_gap_silenced_below_threshold():
    # 0.8 s gap, threshold 1.0 s → no W-GAP
    ...

def test_overlap_detected():
    # ts_start < prev ts_end → W-OVERLAP
    ...

def test_exposure_mismatch_detected():
    # 20 ms vs 40 ms → W-EXP-MISMATCH but still built
    ...

def test_shape_mismatch_quarantines():
    # different (H,W) → quarantined, not in boundaries
    ...

def test_frame_lookup_global_to_local():
    # Stream of 3×1200 → frame 1850 → recording_2, local 650
    ...

def test_frame_lookup_first_and_last_frames():
    ...

def test_quarantine_via_update_stream():
    ...
```

### 9.4 `tests/unit/test_playback_pipeline.py`

```python
def test_pure_imports():
    """P1-3: importing playback_pipeline must not pull in
    fastapi / mantisanalysis.server / mantisanalysis.session."""
    import importlib, sys
    for mod in ('mantisanalysis.session', 'mantisanalysis.server',
                'fastapi', 'uvicorn'):
        sys.modules.pop(mod, None)
    importlib.import_module('mantisanalysis.playback_pipeline')
    for mod in ('mantisanalysis.session', 'mantisanalysis.server',
                'fastapi', 'uvicorn'):
        assert mod not in sys.modules, f"{mod} pulled in by playback_pipeline"
```


```python
def test_dark_subtraction_clamped_at_zero():
    # raw < dark → 0
    ...

def test_gain_offset_applied_in_order():
    ...  # gain then offset, both float64

def test_normalize_uses_p1_p99():
    # synthetic ramp 0..4095 → normalize → np.percentile([1, 99.5])
    ...

def test_threshold_maps_low_to_zero_high_to_one():
    ...

def test_colormap_lut_matches_matplotlib():
    # render via pipeline; render via matplotlib direct → byte-equal
    ...

def test_invert_negates_after_colormap():
    ...

def test_show_clipped_marks_saturated_pixels_magenta():
    ...

def test_rgb_grading_gain_per_channel():
    # rgb_gain=(1.5, 1.0, 1.0) → R channel 1.5× of expected
    ...

def test_rgb_gamma_clip_zero_one():
    ...

def test_rgb_white_balance_lut_2500_to_9500_K():
    ...

def test_overlay_alpha_blend_math():
    # base + over with alpha 0.5 → exact pixel blend
    ...

def test_overlay_screen_blend_math():
    ...

def test_overlay_below_hide_zeros_alpha():
    ...

def test_overlay_above_saturate_clamps():
    ...

def test_render_frame_dimensions_match_input_within_max_dim():
    # 1080p → 1024 max → 1024×576
    ...

def test_burn_in_labels_at_correct_corners():
    # PIL rendering with known font → assert pixel non-bg in corners
    ...
```

### 9.5 `tests/unit/test_playback_export.py`

```python
def test_export_image_png_roundtrip():
    ...  # bytes start with PNG magic, dims match

def test_export_image_tiled_2x2_dimensions():
    ...  # tiled width = 2 * preview_w + 1 (divider)

def test_export_image_tif_8bit():
    ...

def test_export_image_tif_16bit_preserves_high_bit_depth():
    # source is uint16; 16-bit TIFF tag 258 BitsPerSample == 16
    ...

def test_export_image_jpeg_lossy_warning_in_metadata():
    ...

@pytest.mark.skipif(not _has_ffmpeg(), reason="imageio-ffmpeg not installed")
def test_export_video_mp4_roundtrip(tmp_path):
    # 30 fps, 30 frames → 1.0 s duration; ffprobe reports correct duration
    ...

def test_export_video_apng_roundtrip(tmp_path):
    ...

def test_export_video_png_seq_zip(tmp_path):
    ...
```

### 9.6 `tests/headless/test_playback_render.py`

Render parity:

```python
def test_preview_and_export_byte_equal_no_labels():
    """P2-6: byte-equality test runs with include_labels=False.
    PIL TrueType hinting differs across platforms, so labels are
    tested separately via corner-pixel-non-bg."""
    # Build synthetic stream
    # Call /frame/0.png?...&labels_timestamp=false&labels_frame=false&...
    # Call /exports/image with include_labels=False
    # assert bytes_a == bytes_b

def test_label_burnin_corners_non_bg():
    """Companion: with labels enabled, assert corner pixels are
    non-background (rather than asserting exact bytes)."""
```

This is the linchpin assertion that proves the WYSIWYG promise for
the rendered image content; label rendering is asserted via shape,
not bytes.

## 10. Frontend tests

### 10.1 React state reducer

`web/src/playback/__tests__/state.test.ts` (Vitest):

```ts
test('view/add appends a fresh view with default fields', ...);
test('view/lock sets lockedFrame and selectedId stays', ...);
test('stream/built resets views if stream changed identity', ...);
test('view/copy-settings-to copies only display+correction fields', ...);
test('layout/set persists to localStorage and clamps view count', ...);
```

We add Vitest as a dev-dep if it's not already there; otherwise the
existing `npm run test` setup (Storybook test runner is separate).

### 10.2 Component snapshot

Storybook stories for `ProcessingBadge`, `FilePill`, `DarkFrameRow`,
`ViewerCard` (locked / failed / loading variants), `StreamChip`. Per
existing pattern (`Brand.stories.tsx`, `Buttons.stories.tsx`,
`ChannelChip.stories.tsx`). Stories are nice-to-have for review;
they are not blocking on the initiative.

## 11. Browser-verification artifacts

Per `UI_VERIFICATION.md`. For each milestone we capture:

- `.agent/runs/recording-inspection-implementation-v1/screenshots/`:
  - `m5-empty-state.png` (light + dark)
  - `m5-narrow-empty.png`
  - `m6-builder.png`, `m6-dark-manager.png`, `m6-warning-banner.png`
  - `m7-2x2.png`, `m7-side.png`, `m7-stack.png`, `m7-3plus1.png`,
    `m7-locked.png`, `m7-timeline.png`
  - `m8-source.png`, `m8-display.png`, `m8-rgb.png`,
    `m8-presets.png`, `m8-labels.png`
  - `m9-overlay-inline.png`, `m9-overlay-builder.png`
  - `m10-export-image.png`, `m10-export-video-setup.png`,
    `m10-export-video-progress.png`, `m10-export-video-done.png`
  - `m11-warnings.png`, `m11-narrow-1180.png`, `m11-narrow-1024.png`

- Console transcript saved per milestone (`console-mN.txt`).
- Network HAR saved per milestone (`network-mN.har`).

## 12. Smoke-test harness changes

Edit `scripts/smoke_test.py`:

- `tier1`: append the 5 new modules.
- `tier2`: append the playback render block.
- `tier3`: append the playback round-trip.

Each addition is gated on imports that already exist (we don't break
Tier 0 doc-consistency by introducing references before code lands).
Each milestone commit updates the smoke ladder *concurrently* with
the code so smoke stays runnable at every commit.

## 13. CI considerations

- Tier 1 / Tier 2 / Tier 3 run in CI today. Adding the playback
  round-trip costs ~2 s wall-clock. Acceptable.
- Tier 4 / 5 (Playwright) are not wired in CI today (chromium ~300 MB).
  We document the manual run in `Status.md`. CI wiring is tracked
  separately under R-0011.
- Tier 7 axe-core stays in `tests/web/test_accessibility.py` and
  runs alongside Playwright; if not installed, the test skips.

## 14. Test environment guards

- `imageio-ffmpeg` ships under
  `[project.optional-dependencies].playback-video` in
  `pyproject.toml`. Per planner-architect P0-3, this is a real
  scope item with a `DECISIONS.md` entry. Per user 2026-04-24,
  M10 will not close without it (it's a blocker, not a deferral).
- Tests use `_has_ffmpeg()` helper:

  ```python
  def _has_ffmpeg() -> bool:
      try:
          import imageio_ffmpeg
          return Path(imageio_ffmpeg.get_ffmpeg_exe()).exists()
      except Exception:
          return False
  ```

- Tests that require ffmpeg use `@pytest.mark.skipif(not _has_ffmpeg(), ...)`.
  They never silently skip; the skip reason is descriptive.
- `MANTIS_PLAYBACK_TEST=1` env var enables test-only endpoints. Per
  planner-architect P1-11, set via `monkeypatch.setenv` scoped to
  the `web_server` fixture in `tests/web/conftest.py` so the var
  doesn't leak across shells. The gate is read inside
  `_mount_playback_api(app)` at app construction (not at module
  import) so the gate is per-process, not per-import.

## 15. Acceptance test pyramid

```
        / Tier 5 + Tier 7 + Tier 8     \  (a few full flows; persona-driven)
       /                                \
      /  Tier 4 — boot smoke              \  (1 file, ~5 s)
     /---------------------------------------\
    /    Tier 3 — TestClient round-trip       \  (1 round-trip, ~2 s)
   /-------------------------------------------\
  /     Tier 2 — pipeline + render parity      \  (5–8 s)
 /---------------------------------------------\
/      Tier 1 — imports + unit tests            \  (≤ 1 s)
\----------------------------------------------/
```

Pyramid is intentionally heavy at the bottom: most regressions are
caught by unit tests on the pure-NumPy modules. Browser tests exist
for the user-facing flows that unit tests can't catch (like "did the
mode tile actually appear?").

## 16. Manual verification checklist (close-out)

Before declaring complete (per STOPPING_CRITERIA.md):

- [ ] Run `python scripts/smoke_test.py --tier 0` through `--tier 4`.
- [ ] Run `python -m pytest -q`.
- [ ] Run `pytest -m web_smoke -q`.
- [ ] Run `npm run build` + `npm run lint` + `npm run typecheck`.
- [ ] Open the app at 1440×900, walk every flow in `flows.md`, save
      screenshots.
- [ ] Resize to 1180×800 and 960×640, verify responsive collapse.
- [ ] Flip light ↔ dark theme; verify no contrast regressions.
- [ ] Cycle accent (blue / violet / teal / amber); verify accent
      tokens propagate to Playback.
- [ ] Walk the keyboard: Tab through every region, Esc closes
      modals, focus returns to triggers.
- [ ] Spawn the reviewer subagents listed in ExecPlan §10.
- [ ] Resolve every P0 / P1 finding.
- [ ] Document P2 / P3 deferrals in `BACKLOG.md`.
- [ ] Update HANDOFF / CHANGELOG / DECISIONS / RISKS / ARCHITECTURE
      / REPO_MAP / manifest.

## 17. Known test gaps (deferred)

- **Cross-browser smoke.** Playwright `webkit` and `firefox` drivers
  are not wired in. Tier 4 runs Chromium only — same as today's
  baseline. Wired in M12 if straightforward; otherwise documented
  as a follow-up.

## 17a. Tier-6 visual-regression baselines — captured per milestone (P1-6)

Per planner-architect P1-6, baselines are **captured incrementally
at every milestone close**, starting M5. M12 audits the full set.
Baselines stored under `tests/web/__baselines__/playback/` named by
wireframe id and viewport:

Per-milestone baseline pickups:

- **M5**: `w1-empty-state` (light + dark + 1024 + 1440 + 1920).
- **M6**: `w2-loading`, `w3-stream-builder`, `w4-dark-manager`.
- **M7**: `w5-single`, `w6-2x2`, `w8-timeline` — all viewports.
- **M8**: `w7-inspector-rgb`, `w11-rgb-grading`.
- **M9**: `w9-overlay-inline`, `w10-overlay-builder`.
- **M10**: `w12-export-image`, `w13-export-video-progress`.
- **M11**: `w14-warning-center`, `w15-narrow-1180`.
- **M12**: full audit + delta report; reject baselines with > 2%
  drift since previous milestone.

Naming convention:

```
tests/web/__baselines__/playback/
├── w1-empty-state-light-1440x900.png
├── w1-empty-state-dark-1440x900.png
├── w3-stream-builder-light-1440x900.png
├── w6-2x2-light-1440x900.png
├── w6-2x2-dark-1920x1080.png
├── w8-timeline-light-1440x900.png
├── w10-overlay-builder-light-1440x900.png
├── w12-export-image-light-1440x900.png
├── w13-export-video-progress-light-1440x900.png
├── w14-warning-center-light-1440x900.png
└── w15-narrow-1180x800.png
```

`tests/web/test_playback_visual.py` uses
`expect(page.locator('[data-screen-label]'))
  .to_have_screenshot('w6-2x2-light-1440x900.png', threshold=0.02)`.

Threshold of 2% accommodates font anti-aliasing differences across
machines. CI pins chromium revision to keep baselines stable.

## 17b. Real-data manual verification

Documented in `Status.md` per milestone:

- M1: run `python -c "from mantisanalysis.recording import inspect_recording; print(inspect_recording('/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5'))"` against three different files (different exposures).
- M3: build a stream from 3 files in the dev folder via the test
  endpoint; confirm continuity warnings make sense.
- M5: open Playback in browser, drag-drop a real file from the dev
  folder.
- M7: load the dev folder, scrub timeline, confirm responsiveness.
- M10: export 1 second of video from a real file; confirm playback
  in QuickTime / VLC and sidecar JSON correctness.
- M11: send a real frame to USAF / FPN / DoF; confirm the analysis
  mode sees a usable source.

## 17c. Parallelized export tests

`tests/unit/test_playback_export.py::test_workers_reopen_h5_by_path`:

- Submit an export job with `worker_count=4` against a synthetic 100
  -frame stream.
- Verify each worker process records its own h5py.File open via
  a debug counter logged through the progress callback.
- Verify total wall-clock < single-threaded baseline × 0.6 (proves
  parallelization, not strict 4× since I/O dominates).
- Verify frame ordering in the output is deterministic regardless
  of worker completion order.

## 17d. CCM tests

`tests/unit/test_ccm.py`:

- `test_solve_identity_from_identity_patches`: identity matrix
  recovers cleanly.
- `test_solve_known_color_shift`: build patches with a known shift,
  solve, verify residual_rms < 1e-6.
- `test_solve_underdetermined_warns`: 2 patches → singular →
  `stable=false`.
- `test_apply_ccm_to_rgb_array`: matrix mult correctness.
- `test_det_guard_refuses_singular`: |det| < 1e-3 → returns
  `stable=false` and refuses application.

`tests/web/test_playback_workspace.py::test_ccm_apply`:
- Open RGB view, expand RGB-grading, enable CCM, edit cell (1,1) to
  1.5, confirm preview PNG URL changes and image differs from
  identity-CCM render.

## 17e. Send-to-mode handoff tests

`tests/unit/test_playback_handoff.py`:

- Build playback stream, render frame, call handoff to USAF
  in-process, assert `STORE.get(source_id)` returns a `LoadedSource`
  whose `channels.keys()` matches the playback frame's channel
  dict.
- Repeat for FPN and DoF.
- Test `preserve_dark=True` — handoff keeps dark_channels populated.
- Test `preserve_dark=False` — handoff drops dark.

`tests/web/test_playback_handoff.py`:
- Right-click ViewerCard → context menu has "Send to" submenu.
- Click USAF → modal opens → confirm → mode switches to USAF →
  `source.shape` matches.

## 17f. Once-per-session warning modal tests

- Trigger `W-META-TS` once → modal opens.
- Dismiss; trigger again → no modal, only inline chip.
- Switch to a different `W-META-*` code → modal opens for that one.

## 17g. Frame-LRU adjustment

- User sets LRU to 256 MB → cache evicts down to 256 MB.
- User sets LRU to 8 GB → cache holds all served frames up to the
  byte budget.
- Setting LRU below current size triggers eviction down to the new
  cap.
- **Process-global cap enforcement** (risk-skeptic P0-C): 4 streams
  each request a frame larger than `cap/4` → cap honored, oldest
  evicted across streams (not within single stream).

## 17h. Cross-process cancel test (risk-skeptic P0-A)

`tests/unit/test_playback_export.py::test_cross_process_cancel_within_one_batch_time`:

- Submit a 1000-frame export with `worker_count=4` against a
  synthetic stream (~80 ms/frame render).
- After 5 seconds of rendering, call `cancel`.
- Assert `status == 'cancelled'` within `worker_count *
  time_per_frame + 1 s` slack.
- Assert exactly 0 frames are encoded after the cancel was
  observed.

## 17i. Eviction listener kind-filter test (risk-skeptic P0-B)

`tests/web/test_playback_eviction_routing.py`:

- Boot the app on a real server.
- Programmatically dispatch `mantis:source-evicted` with
  `detail.kind='stream', detail.source_id='xyz'`.
- Assert no `POST /api/sources/load-sample` request fires.
- Assert the Playback reducer receives the event (asserted via a
  test-mode global hook).
- Repeat for `kind='source'` (default) → assert load-sample DOES
  fire (back-compat).

## 17j. ffmpeg gate runs the binary (risk-skeptic P1-D)

`tests/unit/test_playback_export.py::test_has_ffmpeg_actually_runs_binary`:

- Mock `imageio_ffmpeg.get_ffmpeg_exe()` to return a path to a
  non-functional binary (e.g. `/usr/bin/false`).
- Assert `_has_ffmpeg()` returns False.
- Mock to return a working `python` interpreter (returncode != 0
  for `-version`) → False.
- With real `imageio_ffmpeg.get_ffmpeg_exe()` if present → True.

## 17k. GIF cap test (risk-skeptic P1-E)

`tests/headless/test_playback_api.py::test_gif_export_caps_at_300_frames`:

- POST `/api/playback/exports/video` with `format='gif'`,
  `frame_range=[0, 500]`.
- Assert response status 422.
- Assert response JSON body has `code == "W-EXPORT-GIF-CAP"`.

## 17l. Upload-path consistency (risk-skeptic P1-H)

`tests/headless/test_playback_api.py::test_upload_persists_to_disk`:

- POST `/api/playback/recordings/upload` with a synthetic H5.
- Assert the resulting `RecordingHandle.path` exists on disk
  under `outputs/playback/uploads/`.
- Assert `RecordingHandle.bytes_cache` is not present (field
  removed entirely).

## 17m. Env var ordering (risk-skeptic P1-I)

`tests/web/conftest.py` asserts that the `web_server` fixture
sets `MANTIS_PLAYBACK_TEST=1` BEFORE `from mantisanalysis.server
import app`. A Tier 4 sanity test GETs `/api/playback/health` and
asserts the response body lists the test-only `load-sample`
endpoint (or its presence flag).

## 17n. Timestamp edge-case tests (risk-skeptic P1-J)

`tests/unit/test_playback_stream.py`:

- `test_identical_first_timestamps_caller_order_wins`: two files
  with identical `ts_start_s` → caller-supplied order is preserved.
- `test_exact_zero_gap_no_warning`: `ts_start[i] == ts_end[i-1]`
  exactly → no W-GAP, no W-OVERLAP.
- `test_intra_file_non_monotonic_emits_W_TS_DISORDER`:
  timestamp array decreases mid-file → `W-TS-DISORDER` warning;
  build still succeeds with a flagged boundary.
- `test_very_large_absolute_timestamps_preserved`: ts_start ≈ 1.7e9
  (Unix epoch) → `ts_end - ts_start` arithmetic stable to ms.

## 17o. Feature-flag gating (risk-skeptic P1-K)

`tests/web/test_playback_boot.py`:

- Default state: `localStorage.getItem('mantis/playback/enabled')
  == null` → rail tile not visible; `4` keypress is no-op.
- Set localStorage `mantis/playback/enabled='1'` → reload → rail
  tile visible; `4` activates Playback.
- Tier 4 captures both states.

## 17p. Double-dark refusal on handoff (risk-skeptic P1-L)

`tests/unit/test_playback_handoff.py::test_handoff_dark_already_subtracted_blocks_double_subtract`:

- Build a synthetic Playback stream with dark applied
  (`view.dark_on=true`).
- Call handoff to USAF.
- Assert returned `LoadedSource.dark_already_subtracted == True`.
- Run USAF dark-attach on the new source → assert the dark math
  is a no-op (or refuses with a clear error). The pixel values
  match the pre-handoff post-dark image, not double-subtracted.

## 17q. DELETE /streams/{id} mid-export 409 (risk-skeptic P2-P)

`tests/headless/test_playback_api.py::test_delete_stream_with_active_job_returns_409`:

- Submit a long-running export against stream sid.
- DELETE /streams/{sid} while progress is rendering → 409 Conflict
  + body has `active_job_id`.
- Cancel the job; DELETE again → 200.

## 17r. CCM solver coverage (risk-skeptic P2-R)

`tests/unit/test_ccm.py`:

- `test_solve_n2_underdetermined_warns` (already planned).
- `test_solve_n3_exact_determined_returns_zero_residual`: 3
  linearly-independent patches → exact fit, residual_rms ≈ 0.
- `test_solve_n4_overdetermined_returns_finite_residual`: 4
  patches → least-squares with non-zero residual.

## 17s. Video WYSIWYG perceptual parity (risk-skeptic P1-G)

`tests/headless/test_playback_render.py::test_video_first_frame_perceptual_parity`:

- Render frame 0 via `/frame/0.png` → bytes_a.
- Render same frame as MP4 first frame; decode with imageio.
- Compute per-channel mean diff and max diff vs bytes_a's RGB.
- Assert mean diff < 5 LSB, max diff < 20 LSB.
