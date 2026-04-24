# STOPPING_CRITERIA — when "done" is actually done

Before declaring a major change / initiative complete, the
implementing agent must satisfy **every** applicable item below.
No self-certification after the first green test run.

Cross-referenced from `AGENT_RULES.md` (the hard-rule of this
document is a rule of the project).

---

## The rule

**Do not say "complete" until:**

1. All required quality gates for the change type have run and are
   green. See `QUALITY_GATES.md` per-change-type table.
2. Targeted tests for every touched area were added or re-run.
3. Browser verification was done for UI changes. Screenshots exist
   on disk. See `UI_VERIFICATION.md`.
4. Browser console + network were inspected; no uncaught errors,
   no unexpected 4xx/5xx.
5. Independent review subagents relevant to the work were spawned
   and their findings resolved. See
   `skills/independent-review-loop/SKILL.md`.
6. Every P0 finding from any reviewer is fixed.
7. Every P1 finding from any reviewer is fixed.
8. Every P2/P3 finding is either fixed or has a `B-000N` entry in
   `BACKLOG.md` with disposition rationale.
9. Docs updated. See `skills/docs-sync/SKILL.md`.
10. Active initiative's `Status.md` updated.
11. `.agent/HANDOFF.md` updated.
12. `.agent/CHANGELOG_AGENT.md` has a new top-line entry.
13. New decisions recorded in `.agent/DECISIONS.md`.
14. New risks recorded in `.agent/RISKS.md`.
15. `git status -sb` confirmed; dirty files listed in Status.md.
16. Final response to the user honestly states: what was verified,
    what was NOT verified (and why), remaining limitations, and any
    risks that persist.

---

## Check-off template

Copy-paste this into the initiative's `Status.md` "Final
verification checklist" section. Walk it.

```markdown
### Final verification (YYYY-MM-DD)

Gates (from QUALITY_GATES.md per-change-type table):

- [ ] Tier 0 — agent-doc consistency (if docs touched)
- [ ] Tier 1 — imports
- [ ] Tier 2 — headless figures
- [ ] Tier 3 — FastAPI endpoints
- [ ] Tier 4 — browser smoke (`pytest -m web_smoke`)
- [ ] Tier 5 — feature Playwright tests
- [ ] Tier 6 — visual regression (if applicable / baseline exists)
- [ ] Tier 7 — accessibility checklist
- [ ] Tier 8 — performance profile
- [ ] pytest -q full suite green

Browser verification (see UI_VERIFICATION.md):

- [ ] App booted; mount verified
- [ ] Screenshots captured (light + dark + responsive sizes)
- [ ] Console error-free after interaction
- [ ] Network error-free after interaction
- [ ] Keyboard walk complete; Esc closes modals; focus return works
- [ ] Empty / loading / error / success states verified
- [ ] Exports verified if applicable

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

Docs:

- [ ] ARCHITECTURE.md (if architecture changed)
- [ ] REPO_MAP.md (if files added/removed/renamed)
- [ ] SETUP_AND_RUN.md (if commands / install changed)
- [ ] WORKFLOWS.md (if workflow changed)
- [ ] QUALITY_GATES.md (if tiers changed)
- [ ] TOOLS_AND_SKILLS.md (if tools changed)
- [ ] README.md (if user-facing surface changed)
- [ ] manifest.yaml (if modules / commands / entry points changed)
- [ ] DECISIONS.md (if decisions made)
- [ ] RISKS.md (if risks surfaced or closed)
- [ ] BACKLOG.md (if deferrals booked)

State:

- [ ] Status.md — Progress updated
- [ ] HANDOFF.md — Last updated, current state, next action
- [ ] CHANGELOG_AGENT.md — new entry
- [ ] git status -sb captured and consistent with docs

Honesty:

- [ ] Final response to user: what was verified, what wasn't, why.
```

---

## Severity rules (consistent with agents/ and skills/)

- **P0** — blocks further work. Must be fixed before any next step.
- **P1** — blocks final sign-off. Must be fixed before claiming
  complete.
- **P2** — should fix. May be deferred ONLY with a `B-000N` entry
  that includes rationale and pointer back to the initiative.
- **P3** — nice-to-have. Backlog.

The implementing agent is the adjudicator of disposition; it does
NOT get to grade its own *quality* of work (that's what the
reviewers are for). It DOES get to decide whether a P2 is worth
fixing now or later, provided the deferral is documented.

---

## Anti-patterns

Things that look like progress but don't satisfy stopping criteria:

- "Tier 1 passed, shipping." — mandatory tiers depend on change
  type; see `QUALITY_GATES.md`.
- "Tests pass." — which tests? Unit? API? Browser? Name them.
- "Looks correct in the diff." — AGENT_RULES rule 14 bans this for
  UI work.
- "I'll add the test next session." — add the test this session OR
  explicitly defer with BACKLOG entry. No promissory notes.
- "Reviewer found nothing important." — "important" is not a
  severity. Cite severities and dispositions.
- "Docs updated." — which docs? Cross-reference the change.

---

## When you genuinely cannot satisfy a criterion

Sometimes a criterion is inapplicable or blocked:

- Playwright isn't installed on this workstation → document install
  command + run result expectation; `Tier 4 — deferred` in Status.md.
- Real-sample H5 isn't available → verification with synthetic
  fixture documented; `Tier 8 — deferred pending sample`.
- External service broken → note + plan to re-verify when restored.

Deferrals are fine. Silent skips are not. Any deferral lives in
Status.md "Known checks still required" with a specific re-check
trigger.

---

## Escalation

- Criterion fails and user wants to ship anyway → document the
  waiver in `DECISIONS.md` with user approval recorded.
- Criterion is systematically failing across initiatives → that's a
  process issue; open a `workflow-v<N>` initiative to fix the
  harness.
- Unsure if a criterion applies → ask the user; do not silently
  skip.
