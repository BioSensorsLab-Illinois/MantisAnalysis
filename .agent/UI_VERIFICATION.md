# UI_VERIFICATION — browser / UI verification protocol

MantisAnalysis is a browser-based app. No UI change may claim
completion without a live render + interaction + evidence. This
protocol is the canonical checklist, cross-referenced from
`AGENT_RULES.md` rule 14, `QUALITY_GATES.md` Tiers 4–7, and
`skills/react-browser-ui-change`.

---

## 1. Why this document exists

Diffs lie. A React edit that reads "the button should say 'Export'
instead of 'Download'" can still:

- Crash at mount because an import was reshuffled.
- Break responsive layout because the text ran wider than the
  container.
- Strand focus inside a modal on Esc.
- Miss accessibility contrast after a palette tweak.
- Serialize to a 0-byte export PNG because a font didn't load.

None of these show up in `git diff`. They show up in the browser,
and an agent that claims "done" without opening one is self-
certifying broken work. Don't.

---

## 2. The browser-verification ladder

Apply every row relevant to the change class. Skip rows only with
explicit rationale in Status.md.

| Step | What | Tool | Mandatory for |
|---|---|---|---|
| A | Boot the app | Claude Preview MCP (`preview_start`) or `python -m mantisanalysis --no-browser --port 8765` | All UI changes |
| B | Capture a screenshot of the changed surface | `preview_screenshot` or OS screenshot | All UI changes |
| C | Inspect the screenshot | Visual reading | All UI changes |
| D | Check browser console | `preview_console_logs` | All UI changes |
| E | Check network for 4xx/5xx | `preview_network` | API-touching flows |
| F | Exercise keyboard | `preview_click` + Tab / Esc / Enter | Controls / modals |
| G | Verify focus ring visible on focused control | `preview_inspect` | Controls / modals |
| H | Resize to 1024×768 and 1920×1080 | `preview_resize` | Layout changes |
| I | Flip light ↔ dark theme | `preview_click` on the theme toggle | Tokens, palettes, charts |
| J | Verify states: empty / loading / error / success | Interact each path | New/changed flows |
| K | Verify export artifact dimensions + content | Inspect saved file | Export flows |
| L | Add / update Playwright test | Edit `tests/web/test_<feature>.py` | New / changed flows |
| M | Run `pytest -m web_smoke -q` | Bash | After L |
| N | Save screenshot artifacts to `.agent/runs/<slug>/screenshots/` | Move files | Non-trivial UI changes |

---

## 3. Locator discipline

Prefer user-facing locators; they're stable against DOM refactors
and they force better accessibility.

| Rank | Locator | Example |
|---|---|---|
| 1 | role + accessible name | `page.get_by_role("button", name="Export")` |
| 2 | label | `page.get_by_label("ROI")` |
| 3 | visible text | `page.get_by_text("Detection limit")` |
| 4 | placeholder | `page.get_by_placeholder("e.g. 10.5")` |
| 5 | title attribute | `page.get_by_title("Theme toggle")` |
| 6 | `data-testid` — add in source first | `page.get_by_test_id("roi-drag-handle")` |
| 7 | CSS / XPath — **avoid** | — |

When step 6 is needed, add the attribute in source (`web/src/*.jsx`)
rather than leaving a brittle selector in the test.

---

## 4. Web-first assertions (required)

Use assertions that auto-retry until visible / enabled / whatever.

✅ Good:

```python
from playwright.sync_api import expect
expect(locator).to_be_visible()
expect(locator).to_have_text("Detection limit ≥ 11.3 lp/mm")
expect(locator).to_contain_text("Detection limit")
expect(locator).to_be_enabled()
expect(page).to_have_url(...)
```

❌ Bad:

```python
page.wait_for_timeout(2000)          # flaky
if locator.inner_text() == "foo":     # no retry
page.$("css-selector")                # deprecated API
```

---

## 5. Console & network

Every browser verification attaches listeners:

```python
errors: list[str] = []
page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
page.on("pageerror", lambda exc: errors.append(str(exc)))

responses: list[tuple[str, int]] = []
page.on("response", lambda r: responses.append((r.url, r.status)))
```

After the interaction:

- Filter the benign Babel-in-browser warning and React DevTools
  prompt (already filtered in `tests/web/test_web_boot.py`).
- Assert `errors == []`.
- Assert no response has `status >= 400` for URLs the flow actually
  calls. (Ignore expected 404s if the flow tests them.)

---

## 6. Screenshots

### When to capture

- On every non-trivial UI change — at minimum a before / after pair.
- On every new tab / modal / panel.
- On any accessibility-related change (to prove focus ring, contrast
  fix).
- On any theme-related change (light + dark).

### How

```python
page.screenshot(path="outputs/web-smoke/<slug>-<step>.png", full_page=True)
# or card-level:
locator.screenshot(path="outputs/web-smoke/<slug>-<card>.png")
```

### Where

- During iterative work: `outputs/web-smoke/` (git-ignored).
- On close: move to `.agent/runs/<slug>/screenshots/` and reference
  from `Status.md`.

### Don't

- Commit multi-MB screenshot bundles. Keep per-PNG under ~200 KB.
- Use screenshots as primary assertions without a tolerance policy
  (see `skills/visual-regression`).

---

## 7. Keyboard walk

1. Close modals; start from the top of the page.
2. Press Tab. Log the focused element name + save the walk to
   `screenshots/tab-order.txt` via
   `preview_eval("document.activeElement.outerHTML.slice(0, 120)")`.
3. Continue Tab until focus reaches something expected (or wraps).
4. Shift+Tab — walk backward.
5. Open each modal from a kb trigger (⌘K, Shift+I, Tab-to-trigger +
   Enter).
6. In every modal: Tab stays trapped; Esc closes; focus returns to
   the modal's trigger. Verify focus-return in code:

   ```python
   # Before opening
   trigger_id = page.evaluate("document.activeElement.getAttribute('data-testid')")
   # … open + interact + Esc-close …
   after_close = page.evaluate("document.activeElement.getAttribute('data-testid')")
   assert trigger_id == after_close, f"focus did not return to {trigger_id}, got {after_close}"
   ```

If any step fails, it's P1 at minimum — fix before close.

---

## 8. Responsive matrix

Minimum viewports to verify for layout-touching changes:

| Viewport | Purpose |
|---|---|
| 1024×768 | Small laptop — catches sidebar clipping |
| 1280×800 | Default — most common |
| 1920×1080 | Large desktop — catches unbounded width |

Use `preview_resize` in sequence. Capture a screenshot at each.
Concrete pass criteria:

- `preview_eval("document.documentElement.scrollWidth > window.innerWidth")` returns `false` — no unintended horizontal scroll on `<body>`.
- Primary action button is visible at 1024×768 without scrolling.
- Sidebars don't clip the canvas: the canvas / figure container has a measurable non-zero width.

For deep responsive work, add a 320 CSS-px column sanity check
(mobile-scale reflow per WCAG 1.4.10).

---

## 9. States

Every new or changed surface has four states. Verify each:

- **Empty** — before any user action. Shows guidance, not a blank.
- **Loading** — API in flight. Skeleton / spinner / disabled form.
- **Error** — simulate by stopping the server or sending a bad
  source_id. Error surfaced as text, not color alone.
- **Success** — happy path.

If any state is missing and the surface is new, that's P1.

---

## 10. Scientific-UI extras

MantisAnalysis charts display computed scientific results. Extra
checks:

- Axes labeled with units (`lp/mm`, `px`, `µm`, `mm`, `DN`).
- Tick labels readable at default width; no overlap.
- Legend distinguishes channels with correct
  `plotting.CHANNEL_COLORS`. Verify via preview_eval that the
  computed CSS color on each legend swatch matches the server's
  hex value.
- **Interactions actually move the rendered output.** Not just the
  displayed number — the pixels. Procedure:
  1. Screenshot the canvas / SVG body before interaction.
  2. Change a control (slider, drag, ROI resize).
  3. Screenshot again.
  4. Assert the two PNG byte-sums / hashes differ. For canvas,
     `preview_eval("document.querySelector('canvas').toDataURL()")`
     before + after; compare.
  5. If the number changes but the pixels don't, the chart is
     stale-memoized — P1.
- **Exports: per-card PNG + full-modal PNG WYSIWYG.**
  1. Click Export; get the saved file path.
  2. Read dimensions via `Pillow.Image.open(path).size`.
  3. Compare against on-screen `locator.bounding_box()` width /
     height.
  4. Tolerance ± 2 px for DPR rounding; wider only with
     documented reason.
- CSV exports: open in a spreadsheet; column headers match what
  the on-screen table shows.
- **Primary action visually primary.** Run
  `preview_eval` on the top-3 visible buttons by bounding-box area;
  the primary CTA for the current mode must be among them.
- **Destructive actions confirmed or undoable.** Clear picks,
  Reset to default, Delete source — each either opens a confirm
  dialog OR offers an Undo within the next 10 seconds. Never
  irreversible without warning.

---

## 11. Record artifacts in Status.md

A verified surface leaves a trail:

```markdown
### Browser verification (2026-04-24)

- `preview_start('mantisanalysis', 'http://127.0.0.1:8765')` — OK.
- Light + dark theme screenshots — `.agent/runs/<slug>/screenshots/`.
- Keyboard walk: ⌘K opens; Tab / Shift+Tab ordered; Esc closes;
  focus returns to gear icon.
- `preview_console_logs()` — no errors after interaction.
- `preview_network()` — no 4xx/5xx.
- Viewports: 1024, 1280, 1920 — layout clean.
- Empty / loading / error / success states: each verified.
- Playwright: `pytest tests/web/test_<feature>.py` — PASS,
  wall 4.2 s.
```

---

## 12. Preview MCP unavailable?

If `mcp__Claude_Preview__*` tools aren't connected:

- Boot manually: `python -m mantisanalysis --no-browser --port 8765`.
- Open in a real browser (Chrome + DevTools).
- Use OS screenshot tool (`Cmd+Shift+4` on macOS).
- Use Chrome DevTools Console + Network tab in place of
  `preview_console_logs` / `preview_network`.
- Still run Playwright for automated checks.

Silent verification (no screenshot, no console check) is not
acceptable. If you cannot verify, say so explicitly in Status.md
and treat the change as incomplete.

---

## 13. Link back to skills and agents

- Workflow: [`skills/react-browser-ui-change`](skills/react-browser-ui-change/SKILL.md)
- Test authoring: [`skills/playwright-e2e-verification`](skills/playwright-e2e-verification/SKILL.md)
- Visual regression: [`skills/visual-regression`](skills/visual-regression/SKILL.md)
- Accessibility: [`skills/accessibility-check`](skills/accessibility-check/SKILL.md)
- Performance: [`skills/performance-profiling`](skills/performance-profiling/SKILL.md)
- Reviewers: [`agents/react-ui-ux-reviewer`](agents/react-ui-ux-reviewer.md),
  [`agents/playwright-verifier`](agents/playwright-verifier.md),
  [`agents/accessibility-reviewer`](agents/accessibility-reviewer.md),
  [`agents/performance-reviewer`](agents/performance-reviewer.md)
