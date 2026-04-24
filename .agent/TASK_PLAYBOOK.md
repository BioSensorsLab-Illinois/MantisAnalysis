# TASK_PLAYBOOK

Concrete recipes. Copy-paste starting points for common tasks.

Expanded workflows live under [`skills/`](skills/). These recipes
are the shortest useful path.

---

## Recipe: add a new channel to the loader

Files: `mantisanalysis/image_io.py`, `mantisanalysis/extract.py`,
`mantisanalysis/isp_modes.py` (if a new ISP mode is involved).

See [`skills/h5-io-data-pipeline-change/SKILL.md`](skills/h5-io-data-pipeline-change/SKILL.md).

1. Decide whether this is (a) a new file-format detector in
   `load_any`'s top-level dispatch, (b) a new ISP mode in the
   registry, or (c) both.
2. Add the new detector (extension / magic bytes / metadata field).
3. Return key dict matching the established schema (`HG-R`, `LG-G`,
   etc.). **Rule 6 — channel keys are frozen.**
4. Add / extend a test under `tests/unit/test_bayer.py` or a new
   `tests/unit/test_image_io.py`.
5. Tier 1 + Tier 2 + Tier 3 smoke.
6. Update `.agent/ARCHITECTURE.md` + `.agent/REPO_MAP.md` if a new
   file appeared.

---

## Recipe: add a new FastAPI route

Files: `mantisanalysis/server.py`, a new `tests/unit/test_<route>.py`,
and every React consumer that will call it.

See [`skills/fastapi-api-change/SKILL.md`](skills/fastapi-api-change/SKILL.md).

1. Define the Pydantic request + response models next to the
   existing ones in `server.py`.
2. Add the `@app.get/post/put` decorator; keep response type precise.
3. Raise actionable `HTTPException`s on 4xx.
4. Add a unit test that hits the route with `TestClient` and
   asserts every field.
5. Extend `scripts/smoke_test.py` Tier 3 to exercise the new route.
6. Update `ARCHITECTURE.md` "Analysis response shape" section.
7. Wire the frontend consumer (mode file + any chart that needs the
   fields). Verify in-browser per
   [`UI_VERIFICATION.md`](UI_VERIFICATION.md).

---

## Recipe: add a new tab to an analysis modal

Files: `web/src/analysis.jsx` (current) or
`web/src/analysis/<mode>.jsx` after the analysis-page overhaul.

Scope: purely frontend. No server changes unless the tab needs data
that isn't already available.

1. Find the modal's tab registry (post-overhaul) or the tab switch
   block (today).
2. Add a new tab spec `{ id, label, Component }`.
3. Build the tab body through `<Chart>` + `useChartGeom` + `tokens(style)`
   primitives in `shared.jsx`.
4. Use existing `plotStyle` tokens — do not invent new ones unless
   an initiative says so.
5. Add an empty-state / loading-state / error-state render.
6. Browser-verify at 1024 + 1280 + 1920 widths in both themes.
7. Playwright test under `tests/web/test_analysis_<mode>.py`:
   assert the tab is reachable, renders, and produces an export
   PNG when clicked.
8. Invoke [`react-ui-ux-reviewer`](agents/react-ui-ux-reviewer.md)
   + [`playwright-verifier`](agents/playwright-verifier.md).

---

## Recipe: add a new ISP mode

Files: `mantisanalysis/isp_modes.py`, optional update to
`web/src/isp_settings.jsx` if the UI needs mode-specific copy.

1. Define a new `ISPMode` in the registry with slot list, default
   origin / sub_step / outer_stride, color hints.
2. Extend `tests/unit/test_isp_modes.py` with:
   - Schema test: assert the mode has the expected `channels` list.
   - Extraction test: hand-roll an input, run `extract_by_spec`,
     assert channel shape + mean.
3. If the mode adds a new channel-key name (rare; usually modes
   reuse the frozen schema), also extend
   `tests/unit/test_bayer.py`.
4. Tier 3 smoke: `GET /api/isp/modes` lists the new mode.
5. Update `ARCHITECTURE.md` + `README.md` channel-layout table if a
   new key appeared.
6. Browser-verify via the ISP settings modal (gear icon / Shift+I /
   ⌘K → `isp.settings`).

---

## Recipe: rewrite or add a React mode panel

Files: `web/src/<mode>.jsx` + `web/src/shared.jsx` (maybe).

Treat as an initiative — this is a > 3-file change.

1. Scaffold via [`skills/execplan-large-feature/SKILL.md`](skills/execplan-large-feature/SKILL.md).
2. Invoke [`planner-architect`](agents/planner-architect.md) to
   scope state model, API calls, persistence keys
   (`mantis/<mode>/...` in localStorage), image canvas interactions.
3. Phase the rewrite:
   - Phase 1: primitives under `shared.jsx` (if needed).
   - Phase 2: scaffolding (rail button, basic panel, canvas).
   - Phase 3: interactions + API wiring.
   - Phase 4: analysis modal + export.
   - Phase 5: Playwright coverage.
   - Phase 6: a11y + performance polish.
4. Each phase ends with its own browser verification + smoke.
5. See `gui-rewrite-v1`, `fpn-rewrite-v1`, `dof-rewrite-v1` under
   `.agent/runs/_archive/` for prior patterns.

---

## Recipe: regression test that mirrors a bug fix

Template:

```python
# tests/unit/test_<bug-area>.py
import pytest
from mantisanalysis.<module> import <fn>

def test_<bug_description>():
    # Arrange
    ...
    # Act
    result = <fn>(...)
    # Assert the behavior the fix introduced
    assert result == <expected>
```

Run: `python -m pytest tests/unit/test_<bug-area>.py -q`.

For regressions in user-facing flow, mirror as a Playwright test:

```python
# tests/web/test_<bug-area>.py
@pytest.mark.web_smoke
def test_<bug_description>(web_server):
    from playwright.sync_api import sync_playwright, expect
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 800}).new_page()
        page.goto(web_server, wait_until="networkidle")
        # … reproduce the flow …
        expect(page.get_by_role("button", name="...")).to_be_visible()
        browser.close()
```

See [`skills/playwright-e2e-verification/SKILL.md`](skills/playwright-e2e-verification/SKILL.md).

---

## Recipe: add a new Playwright feature test

See [`skills/playwright-e2e-verification/SKILL.md`](skills/playwright-e2e-verification/SKILL.md).

1. Create `tests/web/test_<feature>.py`.
2. Use the session-scoped `web_server` fixture from
   `tests/web/conftest.py`.
3. Accessible locators + web-first assertions.
4. Attach console + pageerror listeners.
5. Run locally: `pytest tests/web/test_<feature>.py -v`.

---

## Recipe: add a dependency

See [`skills/dependency-change/SKILL.md`](skills/dependency-change/SKILL.md).

1. Justify. Why this dep; why not stdlib; license; maintenance.
2. Add to the right section of `pyproject.toml`.
3. `pip install -e .[dev]` + `Tier 1 + 2 + 3` + `pytest`.
4. Update `TOOLS_AND_SKILLS.md` row.
5. New `D-000N` entry in `DECISIONS.md`.

---

## Recipe: make a release tag

1. Bump `mantisanalysis/__init__.py __version__`.
2. Bump `pyproject.toml version`.
3. `python -m pytest -q` + `Tier 0 + 1 + 2 + 3`.
4. `pytest -m web_smoke -q` (if any UI changes in this release).
5. `git add -p && git commit -m "Release v0.X.Y"`.
6. `git tag v0.X.Y`.
7. `git push origin main --tags` — **explicit user consent required**.
8. Append `CHANGELOG_AGENT.md`.

---

## Recipe: DECISIONS.md entry

Template:

```markdown
## D-000N — <one-line title>  (YYYY-MM-DD)

**Context**: <what forced the choice>
**Options**: <options considered>
**Decision**: <what was chosen>
**Consequences**: <what this locks in>
**Revisit**: <trigger that would make us reconsider>
```

Append at the bottom of `.agent/DECISIONS.md`. Bump the D-000N
counter.

---

## Recipe: RISKS.md entry

Template:

```markdown
## R-000N — <short title> (severity: <low/medium/high>)

**Where**: <file:line>
**Symptom**: <what breaks if ignored>
**Mitigation today**: <workaround or containment>
**Trigger to reconsider**: <when this becomes urgent>
```

Append at the bottom of `.agent/RISKS.md`. Bump the R-000N counter.

---

## Recipe: BACKLOG.md entry

```markdown
## B-000N — <short title>

**Why**: <motivation; link to finding / reviewer comment if any>
**Scope**: <files / modules / surfaces>
**Estimated effort**: <rough size, in sessions / hours>
**Blocks / is blocked by**: <cross-ref>
```

Append. Bump counter. Deferred reviewer findings (P2/P3) land here
with a pointer back to the initiative.
