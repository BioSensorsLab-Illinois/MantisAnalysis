# planner-architect — review report

Conducted: 2026-04-24
Initiative: recording-inspection-implementation-v1
Reviewer brief: `.agent/agents/planner-architect.md`
Disposition: **Approve with the P1 changes** (reviewer's verdict).
Implementer disposition: **Resolve P0 + P1 + P2 inline before M0 close.**

## Summary

3 P0 · 12 P1 · 10 P2 · 8 P3.

## P0 — Blocked

| ID | Title | File / §  | Resolution |
|---|---|---|---|
| P0-1 | "Work directly on `main`" contradicts §14 rollback plan and rule 16 | ExecPlan §15, §14, Status.md | Rewrite §14 to use `git revert <commit>` semantics; explicit note: M1–M5 commits are not user-shippable in isolation. User confirmed work-on-main; honor it but document the trade-off. |
| P0-2 | `Y` synthesis only fires for `rgb_nir`; handoff to USAF/FPN/DoF needs `Y` for non-`rgb_nir` modes | DATA_MODEL §3.1, API_DESIGN §6a | Restrict handoff to modes that supply `Y` (rgb_nir + image-mode-via-Bayer); 422 explicit. Inline `Y` synthesis in `recording.extract_frame` for `rgb_nir`. |
| P0-3 | `pyproject.toml` change not in §3 scope | ExecPlan §3 | Add to in-scope list. Document the new optional dep. |

## P1 — Must fix before M0 closes

| ID | Title | Resolution |
|---|---|---|
| P1-1 | M1 dev-folder verification unreproducible | Demote to "smoke evidence in Status.md," not a gating step |
| P1-2 | M3 needs synthetic 3-recording test | Add test name in TEST_PLAN §17b |
| P1-3 | `playback_pipeline.py` purity test | Inline dark-subtract, add `sys.modules` purity assertion |
| P1-4 | Eviction event name conflict | Standardize on `mantis:source-evicted` + `detail.kind` |
| P1-5 | risk-skeptic pass at M0 close | Add to ExecPlan §10 |
| P1-6 | Visual-regression baselines per-milestone | Add per-milestone capture |
| P1-7 | Shared ProcessPoolExecutor for dark + export | Document in DATA_MODEL §13, sequential dark+export |
| P1-8 | Frame LRU byte-capped, not count-capped | Switch to `frame_lru_bytes` with default 2 GB |
| P1-9 | M1 Tier 2 verification | Reword to Tier 1 + unit tests only |
| P1-10 | M10 wall-clock budget | Soften to ≤12s M-series / ≤25s x86 |
| P1-11 | `MANTIS_PLAYBACK_TEST` env var hygiene | Use `monkeypatch.setenv` in conftest |
| P1-12 | Channel intersection emits `W-CHAN` warning | Add to DATA_MODEL §4 + test |

## P2 — Resolved inline

| ID | Title | Resolution |
|---|---|---|
| P2-1 | Combined LRU memory cap doc | Document in DATA_MODEL §13 |
| P2-2 | `view.live=true` no-op contract | `render_frame` raises NotImplementedError |
| P2-3 | `wb_patch_xy` coordinate system | Use normalized [0, 1] |
| P2-4 | CCM target catalog | Pre-define X-Rite 24-patch sRGB targets |
| P2-5 | Handoff sends RAW, not rendered | Document in §6a explicitly |
| P2-6 | Byte-equality test font hinting | Disable labels for parity test |
| P2-7 | ExportJob pins recording_id | No-evict set during run |
| P2-8 | Storybook tree location | `web/src/stories/playback/` |
| P2-9 | `playback_session.py` filename | Use separate file (not edit existing `session.py`) |
| P2-10 | M5 verification realism | Rail tile + keyboard `4`; load-recording deferred to M6 |

## P3 — Tracked inline as observations

P3-1 / P3-2 / P3-3 / P3-4 / P3-5 / P3-6 / P3-7 / P3-8 — recorded in
the patch commits' inline comments where relevant; not blocking.
