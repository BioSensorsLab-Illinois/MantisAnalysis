# ExecPlan — <slug>

> One initiative = one branch = one ExecPlan + one Status. Created from
> `.agent/templates/ExecPlan.md`. Update at every milestone.

Opened: YYYY-MM-DD
Branch: `<slug>` (or `main` with user consent for small scopes)
Owner: agent (per user ask / internal trigger)

## 1. Goal

What this initiative needs to accomplish in one sentence.

## 2. Why (user value)

Reason / trigger / linked BACKLOG ID (e.g., B-0001). Who benefits,
how.

## 3. Scope (in)

Concrete files / modules / surfaces.

- bullet
- bullet

## 4. Out of scope (deliberately deferred)

Each bullet has a one-line rationale.

- bullet — why not now
- bullet — why not now

## 5. Architecture impact

Which layer(s) of [`ARCHITECTURE.md`](../../ARCHITECTURE.md) are
affected.

## 6. UI/UX impact

User-visible changes — controls, screens, flows, exports. "None" is
a valid answer; say so explicitly.

## 7. Backend / API impact

Which FastAPI routes, Pydantic schemas, session fields. "None" is a
valid answer.

## 8. Data model impact

Channel schema? localStorage keys? H5 parsing? Session store? "None"
is a valid answer.

## 9. Test strategy

Which tiers + which test files will gate the initiative.

- Unit: `tests/unit/test_...`
- Headless: `tests/headless/test_figures.py` (if figures touched)
- API: Tier 3 in `scripts/smoke_test.py` OR `tests/unit/test_<route>.py`
- Browser: Tier 4 via `tests/web/test_<feature>.py` (if UI changed)
- Visual regression: `tests/web/__baselines__/` (only if in scope)
- a11y: per [`../../skills/accessibility-check/SKILL.md`](../../skills/accessibility-check/SKILL.md)
- Performance: per [`../../skills/performance-profiling/SKILL.md`](../../skills/performance-profiling/SKILL.md)

## 10. Verification agents to invoke (at close)

Minimum: `docs-handoff-curator`. Add per change type — see
[`../../agents/README.md`](../../agents/README.md).

- [ ] `docs-handoff-curator`
- [ ] `risk-skeptic`
- [ ] other: <list>

## 11. Milestones

Each independently shippable + verifiable. Mark done as you go.

- [ ] **M1 — <name>** — concrete deliverable; verified by `<check>`.
- [ ] **M2 — <name>** — concrete deliverable; verified by `<check>`.
- [ ] **M3 — <name>** — concrete deliverable; verified by `<check>`.

## 12. Acceptance criteria

- [ ] Tier <N> smoke green (list applicable tiers per QUALITY_GATES.md).
- [ ] pytest green (40+ today, 50+ after this initiative if
      applicable).
- [ ] Browser verification artifacts captured
      (screenshots + console + network + keyboard) — if UI change.
- [ ] All reviewer P0/P1 findings resolved.
- [ ] Docs synced per [`../../skills/docs-sync/SKILL.md`](../../skills/docs-sync/SKILL.md).
- [ ] Status.md + HANDOFF.md + CHANGELOG_AGENT.md updated.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | | | |

## 14. Rollback plan

Simplest way to undo if something goes wrong. Usually: git revert
the initiative's commit series.

## 15. Decisions

Append as they arise during the work.

- (YYYY-MM-DD) **decision**: rationale.

## 16. Surprises & discoveries

- (YYYY-MM-DD) what surprised you, in one bullet.

## 17. Outcomes & retrospective

Filled at close.

- What worked.
- What didn't.
- What you'd do differently next time.
- Which `.agent/` docs got updated.

## 18. Final verification checklist

Executed at the close milestone. Copy of [`../../STOPPING_CRITERIA.md`](../../STOPPING_CRITERIA.md)
check-off template adapted to this initiative.

See `Status.md` for the live checklist; this section is the reminder
that the initiative is not "done" until the stopping criteria are
satisfied.
