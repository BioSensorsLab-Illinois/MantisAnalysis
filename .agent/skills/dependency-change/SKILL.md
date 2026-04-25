---
name: dependency-change
description: How to add, upgrade, or remove a Python or JS dependency in MantisAnalysis. Includes justification, doc update, and verification.
when_to_use:
  - adding a new entry to pyproject.toml
  - upgrading a pinned version
  - removing a dependency
  - adding a JS library (npm install — Vite bundler post bundler-migration-v1 Phase 3)
outputs:
  - pyproject.toml or package.json updated
  - TOOLS_AND_SKILLS.md row added / updated
  - SETUP_AND_RUN.md updated if install changed
  - DECISIONS.md entry justifying the add
related_agents: risk-skeptic, test-coverage-reviewer, docs-handoff-curator
---

# dependency-change

## When to use

Any edit to:

- `pyproject.toml [project.dependencies]`
- `pyproject.toml [project.optional-dependencies].*`
- `package.json` `dependencies` / `devDependencies` (npm — post bundler-migration-v1 Phase 3)

## Hard rules

1. **Justify every dep.** Per `AGENT_RULES.md` rule 12: "No
   cosmetic refactors. Style-only changes burn time and obscure
   review." — by analogy, don't add a dep just because it's popular.
2. **Prefer standard library** when it covers the need adequately.
3. **No lockfile today** — but that may change (see
   `TOOLS_AND_SKILLS.md`). When a lockfile lands, bump it alongside
   every dep change.

## Workflow

### Step 1 — justify

Answer, in writing:

1. What problem does this dep solve?
2. Why is a standard-library or existing-dep solution inadequate?
3. How large is the dep footprint (size, deps-of-deps, maintenance
   burden)?
4. What's its license? Does it conflict with MIT?
5. Is it actively maintained? (Last release < 6 months? Open issues?
   Open PRs merging?)

Record this justification in the initiative's ExecPlan or in
`DECISIONS.md` if the change is standalone.

### Step 2 — scope placement

- Runtime dep → `[project.dependencies]`.
- Dev-only (pytest, ruff, mypy, httpx) → `[project.optional-dependencies].dev`.
- Opt-in feature (Playwright) → own `[project.optional-dependencies].<feature>`.
  Document the opt-in install command.

### Step 3 — pin appropriately

- Pin minimum only (`>=X.Y`) if the dep has stable API.
- Pin exact (`==X.Y`) only when a specific bug is being avoided.
- Avoid floating upper bounds (`<X`) unless a known break is ahead.

### Step 4 — edit `pyproject.toml`

- Maintain sort order (alphabetical within section).
- Include a one-line comment when the dep is non-obvious.

### Step 5 — update docs

- `.agent/TOOLS_AND_SKILLS.md` — add row with Status / Where it's
  configured / Notes.
- `.agent/SETUP_AND_RUN.md` — if the install command changes (new
  optional extra, new post-install step).
- `.agent/DECISIONS.md` — new `D-000N` entry justifying the add.
- `.agent/manifest.yaml` — no changes (dep list isn't mirrored).

### Step 6 — verify

```bash
pip install -e .[dev]   # or .[web-smoke] if applicable
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

All green. If a test fails because of the new dep, revert and
rethink.

### Step 7 — document usage

If the dep is being used immediately, add or extend the module that
uses it + unit test the integration. A dep added but not used is a
smell — close the loop in the same initiative.

### Step 8 — invoke reviewers

- `risk-skeptic` — what about supply chain? licensing? transitive
  deps?
- `test-coverage-reviewer` — is the new surface tested?
- `docs-handoff-curator` — are all docs synced?

## Removal workflow

Same structure in reverse:

1. Confirm no callers (`grep -r '<import>' mantisanalysis/ scripts/ tests/ web/`).
2. Remove from `pyproject.toml`.
3. Update `TOOLS_AND_SKILLS.md` (mark removed or delete row).
4. Update `DECISIONS.md` if it was originally a named decision.
5. Verify gates still pass.

## JS / npm deps

The frontend is Vite-bundled (post `bundler-migration-v1` Phase 3).
Add JS deps via `npm install --save <pkg>` (or `--save-dev` for
build-only deps). Rules:

1. Pin to a specific minor (`^x.y.z` is fine; the lockfile pins exact).
2. Prefer ES-module-first packages (Vite handles CommonJS but ESM
   tree-shakes better).
3. Run `npm run build` and confirm the bundle still loads in-browser
   (Tier 4 / `pytest -m web_smoke`). Plotly-style large packages
   may need `optimizeDeps.include` in `vite.config.js`.
4. Document the package + version in
   `.agent/TOOLS_AND_SKILLS.md` under "Frontend tooling".
5. Commit `package.json` + `package-lock.json` together.

## Acceptance

- [ ] `pyproject.toml` updated with sorted entry + version constraint.
- [ ] `pip install -e .[dev]` (and other extras as relevant) succeeds.
- [ ] Tier 1 + 2 + 3 green.
- [ ] pytest green.
- [ ] `TOOLS_AND_SKILLS.md` row added.
- [ ] `DECISIONS.md` entry for non-trivial deps.
- [ ] `README.md` / `SETUP_AND_RUN.md` install blocks still accurate.

## Escalation

- Dep is experimental / pre-1.0 → flag in the decision entry;
  review semantics of breaking changes.
- Dep requires native compilation (e.g., a C extension) → document
  install prereqs per platform in `SETUP_AND_RUN.md` Troubleshooting.
- Dep is only available via a non-PyPI source → extra scrutiny;
  record in `DECISIONS.md`.
