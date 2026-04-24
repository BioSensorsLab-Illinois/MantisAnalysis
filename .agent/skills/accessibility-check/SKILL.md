---
name: accessibility-check
description: WCAG 2.2 A/AA quick check + automation options for MantisAnalysis UI. Manual tab-through, focus visibility, contrast, labels, roles; axe-core if/when automated.
when_to_use:
  - any substantial React UI change
  - theme / token changes that may affect contrast
  - before closing any UI-heavy initiative
outputs:
  - WCAG 2.2 quick-checklist results recorded in Status.md
  - remediation tasks opened for each failure
related_agents: accessibility-reviewer, react-ui-ux-reviewer
---

# accessibility-check

## When to use

- Adding or changing a modal (Analysis, ISP settings, Help, About).
- Adding or changing a primary control (mode rail, command palette,
  plot-style panel).
- Theme or token changes that may affect contrast.
- Before closing any initiative that shipped UI.

## WCAG 2.2 A/AA quick check

Copy this into the initiative's `Status.md` and fill in as you verify.

| Criterion | What | How to verify | Pass? |
|---|---|---|---|
| 1.1.1 | Every `<img>` has `alt` | Grep `<img` without `alt` in `web/src/*.jsx` | |
| 1.3.1 | Form controls have `<label for>` or `aria-label` | Visual inspect + devtools | |
| 1.4.3 | Body text contrast ≥ 4.5:1 | Browser extension or manual measurement | |
| 1.4.11 | Non-text (control borders, icon) contrast ≥ 3:1 | Inspect + measure | |
| 2.1.1 | Every function reachable by keyboard | Tab through the UI | |
| 2.1.2 | No keyboard trap | Tab in + Tab out every container | |
| 2.4.3 | Focus order matches visual order | Tab through and note | |
| 2.4.7 | Focus visible on every focused control | Tab through with slow-motion | |
| 2.4.11 (2.2) | Focused control not obscured by sticky header / scrim | Tab with modal open | |
| 2.5.7 (2.2) | Drag actions have non-drag alternative | ROI drag, line pick, point drop — is there a numeric input? | |
| 2.5.8 (2.2) | Interactive targets ≥ 24×24 CSS px | Measure buttons, sliders, chips | |
| 3.1.1 | `<html lang="en">` | Check `web/index.html` | |
| 3.3.1 | Error messages in text, not color alone | Trigger an error, inspect | |
| 4.1.2 | Custom widgets have correct ARIA | Mode rail, modals, palette | |
| 4.1.3 | Status messages announced | `role="status"` or `aria-live` on toasts | |

## Manual procedure

### Step 1 — keyboard tour

1. Close all modals.
2. Tab from the top. Log each focused element.
3. Verify the order is top-to-bottom, left-to-right with the visual
   layout.
4. Verify focus ring is visible at each step.
5. Shift+Tab — reverse traversal works.
6. Open each modal (Analysis, ISP settings, Help, About) and Tab:
   must trap focus while open; Esc closes; focus returns to trigger.

### Step 2 — contrast

For each text-bearing element:

- Body text (≥ 14 pt regular, ≥ 18 pt/bold 14 pt) — 4.5:1.
- Large text (≥ 18 pt or 14 pt bold) — 3:1.
- UI controls (button borders, input borders) — 3:1.

Tools:

- Chrome DevTools → Elements → Styles → Computed → hover over color
  shows contrast ratio if both colors are resolved.
- `preview_eval("getComputedStyle(el).color")` + compare against
  background.

### Step 3 — labels

For each form control:

- `<input>` / `<select>` has `<label for>` with text.
- Icon-only button has `aria-label`.
- `<fieldset>` has `<legend>` when grouping radios.

### Step 4 — dynamic announcements

Change a filter; does a screen reader announce the update?

- Playwright can't verify screen-reader output, but it can verify
  `role="status"` and `aria-live="polite"` are set on the affected
  live region.

### Step 5 — zoom / reflow

- Zoom to 200%. Is content still usable?
- Shrink viewport to 320 px wide. Does primary content reflow without
  horizontal scroll (except chart bodies)?

## Automation options

### axe-core via Playwright (recommended for incremental adoption)

```bash
pip install axe-playwright-python
```

```python
from axe_playwright_python.sync_playwright import Axe
axe = Axe()
results = axe.run(page)
violations = [v for v in results.violations if v["impact"] in ("critical", "serious")]
assert not violations, axe.report(violations)
```

Run on a page after the primary flow completes. Violations with
`impact` ≤ `moderate` are P2/P3 — document, don't gate on.

### Manual-only today

Do not add axe-core until an initiative explicitly picks up
accessibility automation; otherwise it's dependency bloat.

## Acceptance

- [ ] WCAG 2.2 quick-check table filled in.
- [ ] Every keyboard path verified.
- [ ] Focus ring visible throughout.
- [ ] No keyboard trap.
- [ ] Contrast measured for primary text + controls.
- [ ] Every new form control has a label.
- [ ] If axe-core used: serious + critical violations = 0.

## Escalation

- Drag-only critical action (e.g., ROI drag) with no keyboard path →
  P1. Either add a numeric input or explicitly document as a known
  gap + add a `R-00NN` entry in RISKS.md.
- Systemic contrast failure (entire theme off) → `react-ui-ux-reviewer`
  escalation + update `shared.jsx::THEMES`.
