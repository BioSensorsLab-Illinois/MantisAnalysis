# backlog-cleanup-v1 — Status

Opened: 2026-04-23
Last updated: 2026-04-23 (all milestones except B-0010 done)

## Milestones

- [x] Baseline smoke tier 1+2 green before starting.
- [x] B-0016 — dead Qt wrapper deletion + plotting.py hoist. Net
      −~1500 LoC across `fpn_render.py`, `dof_render.py`,
      `usaf_render.py`. R-0007 closed.
- [x] B-0020 — DoF modal unit selector (Auto / px / µm / mm / cm)
      with calibration-missing fallback.
- [x] B-0021 — DoF target-tilt `1/cos(θ)` correction end-to-end:
      picker slider (persisted + gated on calibration), run payload
      `tilt_angle_deg`, live modal °-input, header suffix banner, CSV
      + JSON export annotations. Verified at θ=45°.
- [x] B-0019 — all ~85 hardcoded `fontSize={N}` / `strokeWidth={N}` /
      `fontFamily="ui-monospace,..."` literals in analysis.jsx replaced
      with `scaled(N, style)` / `style.*`. `MiniMTFChart` draw-style
      prop renamed → `drawStyle` to disambiguate.
- [x] B-0015 — Playwright smoke scaffolding + passing test under
      `tests/web/`; optional install via `[web-smoke]` extras.
- [x] B-0018 — `docs/validation/README.md` stages the three required
      captures; work itself stays BLOCKED on recordings.
- [x] Legacy backlog sweep — B-0001 / B-0002 / B-0003 / B-0004 /
      B-0008 / B-0009 / B-0013 closed as obsolete or done in
      BACKLOG.md; B-0011 (requirements.txt) deleted.
- [x] Docs updated: HANDOFF, ARCHITECTURE, REPO_MAP, CHANGELOG,
      BACKLOG, DECISIONS (D-0014 added).
- [x] Tier 1 + 2 + 3 smoke green + 40/40 pytest green after all changes.
- [x] Browser visual verification via Claude Preview MCP (dropped
      line + calibration + ran analysis + verified Unit selector,
      Tilt correction at θ=45°, and plotStyle elementScale / lineWidth
      propagation).
- [ ] **B-0010 — initial commit + push** — the only open gate.
      Awaiting explicit user consent.

## Baseline

Started from the tip of `analysis-polish-v1`. Tier 1+2 green at the
tip. Tree was (and still is) fully dirty on `main` — no commit yet.
