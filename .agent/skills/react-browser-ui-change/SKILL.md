---
name: react-browser-ui-change
description: Required workflow for any change to web/src/*.jsx. Includes browser rendering, screenshot inspection, console error check, keyboard check, responsive sanity, and Playwright update.
when_to_use:
  - editing web/src/app.jsx, shared.jsx, usaf.jsx, fpn.jsx, dof.jsx, analysis.jsx, isp_settings.jsx
  - adding a new React component, hook, or context
  - changing a user-visible control, modal, panel, or layout
outputs:
  - the change rendered and verified in a browser
  - screenshots on disk (outputs/verify/ or .agent/runs/<slug>/screenshots/)
  - updated / new Playwright test when the flow is testable
related_agents: react-ui-ux-reviewer, frontend-react-engineer, playwright-verifier, performance-reviewer
---

# react-browser-ui-change

## When to use

Any change to `web/src/*.jsx`. No exceptions for "small" changes —
even a one-character copy tweak gets the browser-verification check
because the cost is small and the risk of unseen regression is real.

Per `AGENT_RULES.md` rule 14:

> Verify frontend changes by actually rendering them. … After any
> non-trivial UI change, take a screenshot and look at it before
> claiming the work done. "Looks correct in the diff" is not
> sufficient evidence.

## Workflow

### Phase 1 — plan the change

1. Identify the affected component(s).
2. If the change touches shared primitives (`shared.jsx`), consider
   invoking `planner-architect` first.
3. If the change touches state model or context, also consider
   `frontend-react-engineer`.

### Phase 2 — make the edit

Use the Edit tool. Keep edits small and focused.

### Phase 3 — run Tier 1 + Tier 2 smoke

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

These don't exercise the browser but catch Python regressions quickly.

### Phase 4 — boot the server

If Claude Preview MCP is connected, use it. Otherwise:

```bash
python -m mantisanalysis --no-browser --port 8765 &
curl -s http://127.0.0.1:8765/api/health
```

### Phase 5 — render + verify

With Claude Preview MCP:

```
preview_start({ name: 'mantisanalysis', url: 'http://127.0.0.1:8765' })
preview_snapshot()
preview_screenshot({ path: '<verify-path>/after.png', fullPage: true })
preview_console_logs()        # check for errors
preview_network()             # check for failed requests
```

Without Preview MCP: open a browser manually and capture screenshots
with the OS screenshot tool. Note that silent verification (no
screenshot saved) doesn't count.

### Phase 6 — interact

For every new or changed control:

1. Click / drag / type to exercise it.
2. Verify the expected server call goes out (check network tab).
3. Verify the expected state change renders.
4. Check for console errors after interaction.

### Phase 7 — states

Verify all four states for the touched surface:

- **Empty** — before any user input.
- **Loading** — while API in flight.
- **Error** — simulate by stopping the server or using a bad source
  ID.
- **Success** — after normal completion.

If any state is missing, that's a P1 finding — fix or surface in
reviewer pass.

### Phase 8 — keyboard

1. Tab through the modified surface. Log the Tab order.
2. Activate each control with Enter or Space.
3. Check Esc closes any modal.
4. Verify focus ring visibility on each focused control.

### Phase 9 — responsive

```
preview_resize({ width: 1024, height: 768 })   # small laptop
preview_snapshot()
preview_resize({ width: 1920, height: 1080 })  # large desktop
preview_snapshot()
preview_resize({ width: 1280, height: 800 })   # default
```

No horizontal clipping of primary content. Sidebars remain usable.

### Phase 10 — theme

Toggle light ↔ dark via the app's theme control. Verify:

- Text contrast remains readable.
- Chart axes / labels remain visible.
- No theme-specific assumptions baked in (white-only background, etc.).

### Phase 11 — Playwright

If the flow is testable, add or update a test in `tests/web/`:

- Use accessible locators (`get_by_role`, `get_by_label`, `get_by_text`).
- Use web-first assertions (`expect(...).toBeVisible()`).
- Attach console + pageerror listeners.
- Keep < 10 s run time per test.

See [`playwright-e2e-verification`](../playwright-e2e-verification/SKILL.md).

### Phase 12 — save artifacts

```bash
mkdir -p .agent/runs/<slug>/screenshots/
mv outputs/verify/*.png .agent/runs/<slug>/screenshots/
```

Reference them from `Status.md`.

### Phase 13 — invoke reviewers

At minimum:

- `react-ui-ux-reviewer` — did the UX work?
- `playwright-verifier` — are the tests proportionate to the change?

For larger changes, add:

- `frontend-react-engineer` — state / perf / maintainability.
- `performance-reviewer` — responsiveness / payload.

See [`independent-review-loop`](../independent-review-loop/SKILL.md).

## Acceptance

- [ ] Tier 1 + Tier 2 smoke green.
- [ ] Browser boot verified (screenshot on disk).
- [ ] Console error-free after interaction.
- [ ] Network error-free after interaction.
- [ ] Keyboard tab / Esc / focus verified.
- [ ] Responsive at 1024 + 1280 + 1920 widths.
- [ ] Both themes verified.
- [ ] Playwright test added or updated (or documented why not).
- [ ] Relevant reviewer agents invoked and P0/P1 findings resolved.

## Escalation

- If the server doesn't boot, halt UI work — fix backend first.
- If a console error appears, treat as P1 — fix before claiming done.
- If the change ripples beyond the originally-listed components,
  consider scoping as an initiative (this skill's scope is
  single-change, not initiative).
