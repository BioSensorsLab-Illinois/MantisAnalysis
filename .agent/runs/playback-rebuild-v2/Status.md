# Status — playback-rebuild-v2

Opened: 2026-04-25
Last updated: 2026-04-25 (M0 in-flight)

## Active milestone: M0 — Wipe v1 + scaffold + failing tests

### M0 deliverables

- [x] Design template archived at `design/` (spec, flows, wireframes,
      JSX prototypes, reference screenshots).
- [x] Old playback module deleted: 6 backend files, 19 frontend files,
      5 test files, 1 script (~14,000 LOC removed).
- [x] Accessibility surface deleted: skill, agent brief, axe-core
      Python dep, axe Storybook addon, test_accessibility.py.
- [x] External references scrubbed: server.py, app.tsx, smoke_test.py,
      conftest.py, package.json, pyproject.toml, .storybook/main.ts,
      .storybook/preview.ts, shared.tsx, usaf.tsx.
- [x] Active agent docs scrubbed: skills/quality-gates,
      skills/react-browser-ui-change, skills/independent-review-loop,
      skills/README, agents/README, agents/test-coverage-reviewer.
      (Historical refs in BACKLOG / DECISIONS / CHANGELOG_AGENT /
      closed runs/* left as archaeology.)
- [x] New module skeleton: `mantisanalysis/playback/{__init__,h5io,library,workspace,events,render,api}.py`.
- [x] New frontend skeleton: `web/src/playback/{tokens.ts,api.ts,index.tsx}`.
- [x] Play tile restored on rail; M0 placeholder visible at the Play tab.
- [x] 8 failing reproduction tests written:
      - `tests/headless/test_playback_v2_backend.py` (6 tests)
      - `tests/web/test_playback_v2_workflow.py` (4 tests, but 2 are
        consolidated to 4 separate concerns)
- [ ] **Final M0 verification**: app boots; Play tile renders the
      placeholder; USAF/FPN/DoF still work; Tier 1+2+3 green;
      8 reproduction tests fail for the right reason.
- [ ] M0 commit.

## Reviewer findings

(none yet — reviewer pass scheduled at M6 close.)

## Next concrete action

1. `python -m pytest tests/headless/test_playback_v2_backend.py tests/web/test_playback_v2_workflow.py -q` — confirm 8 expected fails.
2. `python scripts/smoke_test.py --tier 1`, `--tier 2`, `--tier 3` — confirm green.
3. `python -m mantisanalysis --no-browser --port 8773` + browser preview at Play tab — capture M0 placeholder screenshot.
4. Single `playback-rebuild-v2 M0` commit.
5. Hand off to M1 (backend library + workspace + h5io).
