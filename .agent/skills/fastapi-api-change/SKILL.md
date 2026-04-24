---
name: fastapi-api-change
description: Required workflow for any change to FastAPI routes, Pydantic schemas, or session state in MantisAnalysis. Includes contract-drift detection, error-path tests, and frontend wiring verification.
when_to_use:
  - editing mantisanalysis/server.py, session.py, figures.py
  - adding / removing / renaming a route
  - adding / removing / renaming a Pydantic model field
  - changing a response shape returned by /api/*
outputs:
  - Tier 3 smoke passes
  - new API test (if warranted)
  - frontend updated and browser-verified if response shape changed
related_agents: fastapi-backend-reviewer, planner-architect, test-coverage-reviewer, risk-skeptic
---

# fastapi-api-change

## When to use

Any change to:

- `mantisanalysis/server.py` (routes, schemas).
- `mantisanalysis/session.py` (source store, LRU, dark frame).
- `mantisanalysis/figures.py` (PNG byte serializer).
- `mantisanalysis/image_io.py` / `extract.py` / `isp_modes.py` when it
  changes what the server emits downstream.

Do NOT use this skill for:

- Pure analysis-math edits in `mantisanalysis/*_analysis.py` /
  `usaf_groups.py` that don't cross the API boundary (use unit tests
  only).

## Workflow

### Phase 1 — plan

1. Identify which routes / schemas change.
2. Check every frontend consumer of those routes:
   `grep -n "api/<route>" web/src/*.jsx`.
3. If this is a new route, invoke `planner-architect` to confirm the
   shape.

### Phase 2 — edit the backend

- Define request / response models explicitly as `BaseModel`.
- Precise types (Tuple, List[float], Optional).
- `Field(default_factory=...)` for mutable defaults.
- Actionable `HTTPException` detail strings on 4xx.

### Phase 3 — run Tier 1 + Tier 2

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

### Phase 4 — run Tier 3

```bash
python scripts/smoke_test.py --tier 3
```

Tier 3 boots the ASGI app in-process with `fastapi.testclient` and
hits health + sample load + thumbnail + USAF + FPN + DoF endpoints.

If your new route isn't exercised by Tier 3, either add it to the
smoke script OR add a targeted test in `tests/unit/test_<route>.py`.

### Phase 5 — add a unit test

For schema additions / changes, add a test that:

- Sends a request with the new shape.
- Asserts every new field appears in the response.
- Asserts old fields still appear (backward compatibility) unless
  the change is explicitly documented as breaking.

Template:

```python
# tests/unit/test_<route>.py
from fastapi.testclient import TestClient
from mantisanalysis.server import app

client = TestClient(app)

def test_<route>_happy_path():
    r = client.post("/api/<route>", json={...})
    assert r.status_code == 200
    body = r.json()
    assert "<new_field>" in body
    # assertions on shape / values
```

### Phase 6 — update the frontend consumer

If the response shape changed:

1. Open every `web/src/*.jsx` that calls this route.
2. Update the parser / destructure to pick up new fields.
3. Remove / handle removed fields.
4. Verify with the [`react-browser-ui-change`](../react-browser-ui-change/SKILL.md)
   skill.

### Phase 7 — error-path testing

For each new route:

- Test a `source_id` that doesn't exist → expect 404.
- Test a malformed payload → expect 422 (Pydantic).
- If the route mutates state (`PUT /api/sources/{id}/isp`), test the
  post-state is as expected (e.g., dark frame detached, `raw_frame`
  re-extracted).

### Phase 8 — document

If the change is non-trivial:

- Update `.agent/ARCHITECTURE.md` — "Analysis response shape" table.
- If new endpoint appears: `README.md` curl example.
- Add a `D-000N` entry in `DECISIONS.md` if the shape choice was
  non-obvious.

### Phase 9 — invoke reviewers

- `fastapi-backend-reviewer` — contract + session state.
- `test-coverage-reviewer` — did the right level of test catch the
  risk?
- `risk-skeptic` — concurrency, eviction, partial failure.

## Acceptance

- [ ] Tier 1 / Tier 2 / Tier 3 all green.
- [ ] pytest green (including any new targeted tests).
- [ ] Frontend updated if response shape changed; browser-verified.
- [ ] Error paths covered.
- [ ] Docs updated (ARCHITECTURE response-shape table at minimum).
- [ ] `fastapi-backend-reviewer` pass with no P0/P1.

## Escalation

- Channel-key schema change forbidden by rule 6 — stop and ask user.
- Session `STORE` LRU eviction behavior altered — add a
  `risk-skeptic` review and document in `RISKS.md`.
- Heavy compute added to a debounced route — invoke
  `performance-reviewer`.
