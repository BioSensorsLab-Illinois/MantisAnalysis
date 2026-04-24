# ExecPlan — isp-modes-v1

> One initiative = one branch = one ExecPlan + one Status.

## Goal

Add ISP-mode selection + super-pixel geometry overrides + 4th-channel
rename + RGB color composite display, all through a dedicated floating
settings window. No side-panel real-estate impact.

## Why

User feature request 2026-04-24: the MantisCam fleet produces recordings
from 17 different ISP pipelines (see `MantisCamUnified/cameras/isp/
pipeline_registry.py`), but MantisAnalysis currently hardcodes GSense
dual-gain RGB-NIR. Users need to analyze bare / polarization / custom-
filter recordings too. Channel-key schema (`HG/LG × RGBN`) and Bayer
constants are physically locked → must extend alongside, not replace.

Plan file: `/Users/zz4/.claude/plans/major-feature-request-add-encapsulated-bear.md`.

## Scope (what's in)

- 7 ISP modes in v1: `bare_single`, `bare_dualgain`, `rgb_nir`,
  `rgb_image`, `grayscale_image`, `polarization_single`,
  `polarization_dual`.
- Per-mode user-overridable origin / sub-step / outer-stride (all three,
  full control).
- 4th-channel rename for `rgb_nir` only (UI text input).
- RGB color composite canvas display for modes that expose R/G/B.
- Floating settings window (reuses `Modal` primitive). Opened via TopBar
  gear icon + ⌘K palette + `I` keyboard shortcut.
- New `/api/isp/modes` + `/api/sources/{id}/isp` GET/PUT endpoints.
- Three mode files switch to dynamic channel-default helper.
- Backward compat: existing `HG/LG × RGBN` schema + `ORIGIN = (0,0)` +
  `LOC = {…}` constants in `extract.py` stay byte-identical.

## Out of scope (what's deliberately deferred)

- F13 Foveon pipelines (6 modes).
- GSense mask pipelines (74um, RGBN, quarter-frame, x2-alignment).
- `align_polar` pipeline.
- Existing USAF saved-lines JSON auto-migration across mode switches
  (shown as warning toast; picks preserved byte-identically under
  default `rgb_nir`).
- Real-H5 validation pass (blocked on B-0018 captures).

## Milestones

- [ ] **M0 — Initiative scaffold + isp_modes.py registry** — 7 modes,
      dataclasses, CHANNEL_COLORS extension.
- [ ] **M1 — Data layer** — `extract_by_spec` added, old API preserved,
      `image_io.load_any(isp_mode_id, isp_config)`, `rgb_composite()`.
- [ ] **M2 — Server layer** — 3 new `/api/isp/*` endpoints,
      `LoadedSource.isp_*` + `raw_frame` + `reconfigure_isp`,
      `SourceSummary` extended.
- [ ] **M3 — UI window** — `web/src/isp_settings.jsx` built on Modal;
      gear icon + command palette + `I` shortcut; persists via
      `useLocalStorageState('ispSettings/…')`.
- [ ] **M4 — Mode file integration** — `usaf/fpn/dof.jsx` use
      `defaultAnalysisChannels()`; RGB composite toggle wired to
      thumbnail endpoint.
- [ ] **M5 — Tests + smoke** — new `test_isp_modes.py`,
      `test_isp_override.py`; `test_web_boot.py` extended;
      Tier 1+2+3 smoke + pytest all green.

## Decision Log

- 2026-04-24 — Full 3-parameter control (origin + sub-step +
  outer-stride). User confirmed via AskUserQuestion.
- 2026-04-24 — v1 scope = Bare + RGB-NIR + Polarization only.
  F13 / mask / alignment deferred.
- 2026-04-24 — New `extract_by_spec` as the canonical path; old
  `ORIGIN` / `LOC` / `extract_channel` / `extract_rgb_nir` kept
  byte-identical → `tests/unit/test_bayer.py` stays unchanged.
- 2026-04-24 — Raw frame cached on `LoadedSource` (~32 MB × max 12
  LRU = 384 MB ceiling) so `reconfigure_isp` avoids disk re-read.

## Surprises & Discoveries

- 2026-04-24 — MantisCamUnified's `gs_rgb_nir` defaults differ from
  MantisAnalysis (`origin=(1,0)` vs `(0,0)`; `r-loc=(1,1)` vs `(0,1)`).
  Not a bug — MantisAnalysis is locked to its specific recording
  orientation. Safe to document both; UI defaults = MantisAnalysis's.

## Outcomes & Retrospective

TBD at close.
