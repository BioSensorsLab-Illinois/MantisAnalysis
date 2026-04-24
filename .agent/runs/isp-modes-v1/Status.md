# Status — isp-modes-v1

## Current branch

`main`.

## Current focus

All milestones shipped end-to-end. Browser-verified the gold-path UX
against the synthetic sample. Real-H5 verification remains blocked on
B-0018 captures.

## Progress

- [x] M0 — Initiative scaffold + isp_modes.py registry
- [x] M1 — Data layer (extract + image_io + session)
- [x] M2 — Server layer (/api/isp/*)
- [x] M3 — UI window (isp_settings.jsx + gear + palette + shortcut)
- [x] M4 — Mode file integration + RGB composite
- [x] M5 — Tests + smoke

## Smoke status (last verified)

- Tier 1: ✅ PASS (15 modules imported)
- Tier 2: ✅ PASS (figures written to outputs/smoke/)
- Tier 3: ✅ PASS (FastAPI endpoints exercised end-to-end)
- pytest: ✅ 61 passing (59 unit/headless + 2 web — 20 new ISP tests)

## Post-ship fixes (2026-04-24, same session)

1. **Broadcast crash fix** — user reported `/api/sources/{id}/isp → 422:
   operands could not be broadcast together with shapes (1024,1022)
   (1022,1024)` on a real H5. Root cause: `half[r::s, c::s]` produces
   slightly different per-channel shapes when the half-frame dims
   aren't clean multiples of the outer stride, so
   `luminance_from_rgb` couldn't broadcast R/G/B. Fix: new
   `_crop_channels_to_common_shape` helper in `image_io.py`; every
   extraction path (both halves in dual-gain + the full dict after
   merge) cropped to the common min (H, W). New test
   `test_odd_half_dimensions_crop_to_common_shape` builds a
   8188-wide frame (half = 4094) and asserts all channels end up
   with the same shape both at load and after reconfigure.

2. **Editable per-channel loc** — user requested "allow user to set
   RGB-NIR location coordinate too". Added
   `isp_config.channel_loc_overrides = {slot_id: (r, c)}` alongside
   origin / sub_step / outer_stride. Flow-through:
   - `isp_modes.normalize_config` accepts + validates the field;
     unknown slot_ids and negative values rejected.
   - `image_io._apply_mode_to_half` reads override loc per slot with
     fallback to `ChannelSpec.loc` default.
   - `session._summary_dict` emits `channel_loc_overrides` as
     `{slot: [r, c]}` lists (strict JSON).
   - `server.ISPReconfigureRequest` gains
     `channel_loc_overrides: Optional[Dict[str, Tuple[int, int]]]`.
   - `web/src/isp_settings.jsx` replaces the static "(r,c)" display
     with two editable `<input type="number">` cells per slot. A
     small `LOC*` chip replaces `default` when the user diverges
     from the mode's declared loc; when the user resets the value
     to the default, the override is automatically removed from
     the payload.
   - Four new unit tests cover the round-trip, unknown-slot drop,
     negative-value rejection, and the R-slot-points-at-NIR-sub-tile
     scenario.

Smoke after fixes: Tier 1 ✅ · Tier 2 ✅ · Tier 3 ✅ · pytest 65/65.

## Browser verification (preview server, synthetic USAF sample)

- Gear icon renders in TopBar with title "ISP settings (Shift+I)".
- `Shift+I` keyboard shortcut opens the Modal.
- `/api/isp/modes` returns all 7 v1 modes; dropdown populates.
- Switching mode updates geometry inputs + preview formula + channel
  list (rgb_nir → bare_dualgain collapses channels to RAW;
  polarization_dual shows I0/I45/I90/I135 with outer-stride 2,2).
- NIR slot is the only renameable slot (B/R/G show LOCKED). Rename
  input accepts "UV-650" as a staged change.
- "Show RGB color composite on canvas" checkbox only shown for modes
  with `supports_rgb_composite=true` (rgb_nir, rgb_image).
- Apply is disabled on the synthetic source (no cached raw_frame);
  design-intended — error path tested via test_isp_override.py.
- No console errors during boot or modal open.

## Blockers

- **B-0018 real-sample validation** — the one gold-path step the plan
  called out as "blocked on B-0018 captures" stays blocked. Every other
  verification step passes.

## Known checks still required

- Real MantisCam H5 recording: verify (a) legacy `rgb_nir` extraction
  matches a reference captured *before* this change, byte-for-byte;
  (b) switching to `bare_dualgain` on the same source produces
  HG-RAW/LG-RAW that equal the raw half frames; (c) origin override
  actually shifts extracted pixel values.

## Next steps

1. Commit the initiative work in two commits: data+server layer first
   (Python only, Tier 1+2+3 already green), then UI layer (JSX +
   HTML + static no-op docs).
2. When real H5 captures land under `outputs/validation/`, run the
   three verifications listed above against one of them.
3. `analysis-page-overhaul-v1` Phase 3 picks back up — conflict-free
   with this initiative (only shared.jsx was touched for the new
   `defaultAnalysisChannels()` helper + the gear icon glue, far from
   the analysis-modal shell work).

## Uncommitted files

As of end-of-session (before any commit):

```
.agent/runs/isp-modes-v1/        new
mantisanalysis/isp_modes.py      new
mantisanalysis/extract.py        +25 (extract_by_spec)
mantisanalysis/image_io.py       refactor (mode-aware load_any_detail)
mantisanalysis/session.py        LoadedSource.isp_*, reconfigure_isp
mantisanalysis/server.py         /api/isp/* endpoints, rgb_composite
mantisanalysis/plotting.py       +7 CHANNEL_COLORS keys
web/index.html                   +1 script tag
web/src/shared.jsx               +defaultAnalysisChannels, rgbComposite URL param, color keys
web/src/app.jsx                  gear button + palette action + Shift+I + modal mount
web/src/isp_settings.jsx         NEW — ~300 LoC Modal UI
web/src/usaf.jsx, fpn.jsx, dof.jsx  dynamic channel defaults + rgbComposite flag
tests/unit/test_isp_modes.py     NEW — 9 tests
tests/unit/test_isp_override.py  NEW — 11 tests
tests/web/test_web_boot.py       +1 API smoke assertion
```

## Notes for handoff

- `ORIGIN` / `LOC` in `extract.py:25-26` stay byte-identical. Every
  existing test passes. Channel-key schema documented in
  `ARCHITECTURE.md` Key invariants #3 is preserved on the default
  `rgb_nir` path.
- The synthetic-sample source path (`server.py::load_sample`) does NOT
  set `raw_frame`, so `reconfigure_isp` rejects it with RuntimeError
  — that's deliberate; a synthetic source has no upstream raw data
  from which to re-extract. The error surfaces in the UI as a toast.
- localStorage key `mantis/ispSettings/rgbComposite` persists the
  RGB-composite toggle globally (shared across USAF / FPN / DoF modes).
- The `isp_settings.jsx` file writes `ISPSettingsWindow` to `window`
  so `app.jsx` can reference it across the in-browser Babel loader
  that has no ES-module scoping.

## Final verification

_Closed retroactively. This initiative shipped before the stopping-criteria protocol (D-0015, 2026-04-24). Per the existing Status + the 2026-04-24 CHANGELOG_AGENT entry: Tier 1 + 2 + 3 + pytest were green at close. Browser verification was not formalized at that time. Five regressions surfaced by `/ultrareview` post-close and were fixed in `isp-modes-v1-bugfixes-v1`._
