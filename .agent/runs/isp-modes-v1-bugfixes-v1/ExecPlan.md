# isp-modes-v1-bugfixes-v1 — ExecPlan

Opened: 2026-04-24
Branch: `main`
Owner: agent (per user "finish all bug fixes").

## 1. Goal

Fix the five regressions in the just-landed isp-modes-v1 commit
(5608074) surfaced by the /ultrareview remote-agent pass, with
regression tests per finding so the same class of bug can't silently
return.

## 2. Why

`/ultrareview` returned 5 findings on commit 5608074:

- **merged_bug_002 (P0)** — `attach_dark_from_path` +
  `attach_dark_from_bytes` in `session.py:137, :155` call `load_any`
  which was removed from the import list during isp-modes-v1. Every
  dark-frame attach 500s with `NameError`. Closes both dark endpoints.
- **bug_001 (P0)** — `reconfigure_isp` calls `extract_with_mode` on
  an RGB image's 3-D raw frame without plane-splitting; channels come
  back as `(H, W, 3)` 3-D arrays all pointing at the same buffer.
  Thumbnail endpoint 500s (`Image.fromarray` rejects 3-D with mode="L");
  all RGB analysis paths produce garbage.
- **bug_004 (P1)** — `normalize_config` accepts channel-name
  overrides that collide with other slots' default names (e.g.
  rename NIR → `R`); the loop in `_apply_mode_to_half` then
  last-writer-wins silently overwrites real R data with NIR.
- **bug_008 (P1)** — `test_isp_modes_api_reachable` never runs under
  either documented invocation (missing `web_smoke` marker + module-
  scope `importorskip('playwright')` skips the whole file in default
  dev environments).
- **bug_003 (P2)** — `GeomRow` in `isp_settings.jsx` accepts `0` for
  sub_step/outer_stride; server rejects with 422. UX nit.

## 3. Scope (in)

- `mantisanalysis/session.py` — attach_dark methods + reconfigure_isp
  RGB-image branch.
- `mantisanalysis/isp_modes.py` — collision check in
  `normalize_config`.
- `web/src/isp_settings.jsx` — `GeomRow` min prop + optional client
  mirror of the collision check.
- `tests/web/test_web_boot.py` — move importorskip into test body,
  add marker.
- `tests/unit/test_isp_override.py` — regression tests for bug_001 +
  merged_bug_002.
- `tests/unit/test_isp_modes.py` — regression test for bug_004.

## 4. Out of scope

- No product-feature additions. This is pure regression / correctness
  work on shipped code.
- No new ISP modes.
- No refactor of the extract_with_mode / extract_by_spec seam.

## 5. Architecture impact

None.

## 6. UI/UX impact

- ISP settings modal no longer accepts `0` for sub_step / outer_stride
  inputs.
- Renames that collide with another channel are rejected with a
  server 422 error (surfaced as a toast + inline `lastError`).

## 7. Backend / API impact

- `PUT /api/sources/{id}/isp` rejects colliding renames with 422
  (previously silently corrupted data).
- `POST /api/sources/{id}/dark/*` now works (previously 500'd).
- `reconfigure_isp` on an RGB image produces 2-D channel planes
  (previously 3-D broken arrays).

## 8. Data model impact

None.

## 9. Test strategy

Tier 0 + 1 + 2 + 3 + pytest. New tests:

- `test_isp_override.py::test_rgb_image_reconfigure_produces_2d_channels` — bug_001.
- `test_isp_override.py::test_attach_dark_after_reconfigure_works` — merged_bug_002.
- `test_isp_override.py::test_attach_dark_from_bytes_works` — merged_bug_002 coverage for the bytes path.
- `test_isp_modes.py::test_rename_collision_rejected` — bug_004.
- `test_isp_modes.py::test_rename_collision_with_another_override_rejected` — bug_004 extra path.
- `tests/web/test_web_boot.py::test_isp_modes_api_reachable` gains
  `@pytest.mark.web_smoke` AND the module-scope `importorskip` moves
  into `test_root_page_boots`'s body so the plain-HTTP test runs
  under default pytest.

## 10. Verification agents

- `fastapi-backend-reviewer` — contract + session-state changes.
- `test-coverage-reviewer` — regression tests proportionate to bugs.
- `risk-skeptic` — adjacent edge cases (nested collisions, RGB
  4-plane, grayscale reconfigure).
- `docs-handoff-curator` — docs updated.

## 11. Milestones

- [ ] **M1** — bug_004 collision check in `isp_modes.py`.
- [ ] **M2** — bug_001 + merged_bug_002 in `session.py`.
- [ ] **M3** — bug_003 + bug_004 client mirror in `isp_settings.jsx`.
- [ ] **M4** — bug_008 test harness fix in `tests/web/test_web_boot.py`.
- [ ] **M5** — regression tests in `test_isp_override.py` +
      `test_isp_modes.py`.
- [ ] **M6** — Tier 0–3 + pytest green; reviewer pass; close-out.

## 12. Acceptance

- [ ] Tier 0 + 1 + 2 + 3 green.
- [ ] pytest green with ≥ 80 tests (75 current + 5 new regression).
- [ ] `PUT /api/sources/{id}/isp` with `channel_name_overrides={"nir":"R"}` returns 422.
- [ ] `POST /api/sources/{id}/dark/upload` on an RGB source succeeds.
- [ ] Reconfiguring an RGB image with `RGB_IMAGE` (no overrides)
      returns 2-D channel planes.
- [ ] `pytest -m web_smoke -q` collects the boot test AND the
      ISP-modes-API test, OR the latter runs under plain pytest.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Collision check too strict (rejects valid renames) | Low | Only reject if resolved name matches another slot's default_name OR another active rename target. Renames to unrelated strings (e.g. `UV-650`) pass. |
| W-2 | RGB-image plane-split path diverges from load_image_channels | Low | Mirror the existing pattern verbatim. |
| W-3 | `test_isp_modes_api_reachable` relocated to a new file breaks existing import paths | Low | Keep it in `test_web_boot.py`; fix via importorskip move. |

## 14. Rollback plan

`git revert` the bugfix commit(s). Each bug is independent; we can
revert selectively if one fix surfaces a new issue.

## 15. Decisions

- (2026-04-24) Fix dark-attach via `load_any_detail` with the
  source's current ISP mode + config, not by re-adding `load_any`
  to the import. Reason: closes merged_bug_002's sibling gap
  (dark always loaded under source-kind default mode) in the same
  change.
