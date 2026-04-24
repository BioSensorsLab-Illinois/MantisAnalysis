---
name: visualization-canvas-image-pipeline
description: Workflow for image display, canvas, colormap, thresholds, overlays, and export rendering in MantisAnalysis. Includes numerical correctness and visual verification.
when_to_use:
  - editing ImageCanvas / canvas code in web/src/*.jsx
  - editing mantisanalysis/plotting.py (shared matplotlib helpers)
  - editing mantisanalysis/{usaf,fpn,dof}_render.py (matplotlib figure builders)
  - editing mantisanalysis/session.py::channel_to_png_bytes (thumbnail path)
  - editing mantisanalysis/image_processing.py (sharpen, tone, percentile)
  - adding / changing a colormap, threshold overlay, or export rendering
outputs:
  - numerical correctness verified (Tier 2 + relevant unit test)
  - visual correctness verified (browser screenshot + side-by-side)
  - export output inspected at target DPI
related_agents: react-ui-ux-reviewer, performance-reviewer, frontend-react-engineer, playwright-verifier
---

# visualization-canvas-image-pipeline

## When to use

Any change that affects how image / chart data is displayed, styled,
or exported — whether in the browser (canvas, SVG) or via matplotlib.

Scientific accuracy matters here: a colormap scale that's off, a
threshold that clips the wrong percentile, or an export PNG that has
been resampled incorrectly can mislead scientific interpretation.

## Hard rules

- **Numerical correctness comes before visual polish.** Always verify
  unit tests pass before iterating on look-and-feel.
- **Channel colors are canonical.** `plotting.CHANNEL_COLORS` is the
  single source of truth. Do not override per-chart unless
  explicitly intentional (e.g., palette selector).
- **Per-channel Nyquist.** GSense per-channel is at 0.5 cy/channel-pixel
  = 0.125 cy/sensor-pixel. Chart axes + USAF lp/mm labels must reflect
  this.
- **Exports are WYSIWYG.** If on-screen ≠ exported PNG, fix the
  export pipeline, don't paper over the mismatch.

## Workflow

### Phase 1 — identify the surface

- Browser canvas / SVG / React → `web/src/shared.jsx` primitives +
  mode `.jsx` files. See [`react-browser-ui-change`](../react-browser-ui-change/SKILL.md).
- matplotlib figure builder → `mantisanalysis/*_render.py`. No UI.
- Thumbnail PNG bytes → `mantisanalysis/session.py::channel_to_png_bytes`.
- Image processing (sharpen, tone, percentile mask) →
  `mantisanalysis/image_processing.py`.

### Phase 2 — verify math first

Run Tier 1 + Tier 2:

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

Tier 2 writes PNGs to `outputs/smoke/`. Eyeball them to confirm the
change landed.

If adding a new metric / colormap / threshold, add a test:

```python
# tests/unit/test_<feature>.py
def test_colormap_monotone():
    import numpy as np
    vals = apply_colormap(np.linspace(0, 1, 256), name="viridis")
    # Luminance must be monotone-increasing for a perceptually sane map.
    luminance = 0.2126 * vals[:, 0] + 0.7152 * vals[:, 1] + 0.0722 * vals[:, 2]
    assert np.all(np.diff(luminance) > 0)
```

### Phase 3 — verify in browser

Follow [`react-browser-ui-change`](../react-browser-ui-change/SKILL.md)
steps. Critical for vis changes:

- Set known inputs (load sample, pick a predictable line / ROI).
- Screenshot the canvas / SVG / chart.
- Cross-check: is the rendered output numerically consistent with the
  server response?

### Phase 4 — verify exports

For per-card PNG / modal-level PNG / CSV exports:

1. Click Export.
2. Inspect the resulting file size + dimensions.
3. Compare to on-screen rendering. Pixel-align.
4. Open the PNG in an external viewer at 100% zoom. No artifacts.

### Phase 5 — visual hierarchy sanity

- Chart title readable at default zoom?
- Axes labeled with units?
- Tick labels readable, no overlap?
- Legend distinguishes channels correctly?
- `plotStyle` tokens (fontSize, lineWidth, markerSize, etc.) flow
  through correctly?

### Phase 6 — theme check

Toggle light ↔ dark. Verify:

- Chart background changes.
- Grid / axis / text colors adjust.
- Channel colors stay channel-colored (not absorbed by theme accent).

### Phase 7 — performance check for canvas-heavy paths

Canvas-heavy (heatmaps, overlays):

- Verify no redraw on every prop change; should be gated by actual
  data change.
- Check `preview_network` for unexpected extra API calls.

## Acceptance

- [ ] Tier 1 + Tier 2 smoke green.
- [ ] Relevant unit test green.
- [ ] Browser screenshot before / after saved.
- [ ] Theme switch verified.
- [ ] Export PNG inspected; WYSIWYG with on-screen.
- [ ] Axis labels + units correct.

## Escalation

- Colormap / threshold math wrong → halt; consult Zhongmin on
  scientific-correctness choices.
- Export pipeline broken (CORS, canvas misalignment, font missing)
  → `performance-reviewer` + `frontend-react-engineer` pass.
- Channel color drift from `plotting.CHANNEL_COLORS` → fix at source,
  not per-chart.
