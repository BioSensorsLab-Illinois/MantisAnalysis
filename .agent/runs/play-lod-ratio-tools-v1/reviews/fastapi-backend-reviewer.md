# fastapi-backend-reviewer — `/pixel` endpoint review

Verbatim agent output (2026-05-07).

## Summary

The new `frame_channel_pixel` route at `mantisanalysis/server.py:2513-2633` is a faithful, line-for-line clone of the linear-pipeline portion of `frame_channel_roi_stats`. Pipeline parity is intact: same `_resolve_hdr_channels` call shape, same dark-subtract guard order, same `_apply_analysis_isp` invocation, same `_apply_pre_norm` argument order, same `astype(np.float64)` cast. `Cache-Control: no-store` is set, `extra="forbid"` is on the Pydantic model, `x/y` are `Field(ge=0)`, and all 11 tests pass locally. Two genuine gaps: the parity test does not actually pin pixel-equality to roi-stats (it only asserts the value lies in `[min, max]`), and the test suite is missing HDR-channel readback, source-eviction-410, and degenerate-shape coverage.

## Findings

### P0 — None.

### P1

**P1-A. Parity test does not actually verify byte-for-byte parity.**
- File: `tests/unit/test_pixel_endpoint.py:145-194`
- Asserts `pixel.value` lies in `[roi.min - 1e-3, roi.max + 1e-3]` — a tautology, since the pixel is a member of the polygon's selection set.
- Fix: rasterize a polygon to exactly 1 pixel and assert `pixel.value == roi.mean == roi.min == roi.max` within `1e-9`.

**P1-B. HDR fusion path has zero test coverage.**
- File: `tests/unit/test_pixel_endpoint.py`
- Add a test that POSTs `{"x":..,"y":..,"hdr_fusion":"mertens"}` to both `/pixel` and `/roi-stats` (with a 1-pixel polygon) and asserts identical values.

### P2 (deferred to backlog)

- P2-A: 6 unused response fields (`frame_shape`, `apply_dark`, `black_level`, `pipeline_version`, `view_config_applied`, ...).
- P2-B: No concurrent-request test (33 req/sec under fast mousemove).
- P2-C: No source-mismatch / frame-out-of-range coverage (similar shape to roi-stats).
- P2-D: Degenerate `H=0`/`W=0` channel returns 404 instead of 422/500.
- P2-E: `import traceback` inside catch handler (stylistic).
- P2-F: `view_config_applied` copy-paste between two routes — extract a helper.

## Disposition

**FIX-THEN-SHIP** — P1-A and P1-B are tightenings that turn the contract claim into something CI can enforce.
