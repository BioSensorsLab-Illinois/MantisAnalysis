---
name: h5-io-data-pipeline-change
description: Workflow for H5/h5py/image data loader changes. Includes metadata parsing, fixture generation, synthetic H5 tests, large-file concerns, and the ban on committing real H5 binaries.
when_to_use:
  - editing mantisanalysis/image_io.py, extract.py, isp_modes.py
  - adding a new camera format to load_any
  - adding a new ISP mode or channel slot
  - preparing fixtures for tests/unit/test_bayer.py or new io tests
outputs:
  - updated loader(s) with dispatcher test
  - new unit test on synthetic H5 (not real recordings)
  - if channel schema affected: ARCHITECTURE.md + RISKS.md entries
related_agents: fastapi-backend-reviewer, test-coverage-reviewer, risk-skeptic
---

# h5-io-data-pipeline-change

## When to use

Any change that could affect what `load_any` / `load_any_detail` /
`extract_by_spec` return. Specifically:

- New camera format / file extension.
- New ISP mode under `mantisanalysis/isp_modes.py`.
- New channel slot in an existing mode (rare — channel schema is
  near-frozen per `AGENT_RULES.md` rule 6).
- New metadata field surfaced through the loader.
- Change to GSense extraction geometry parameters (`origin`,
  `sub_step`, `outer_stride`) — only via ISP override path, never to
  the legacy constants.

## Hard rules (from `AGENT_RULES.md`)

1. **Rule 5** — `ORIGIN = (0, 0)` and `LOC` at
   `mantisanalysis/extract.py:25-26` are locked to the physical lab
   setup. Do not change them. If a change seems needed, document in
   `DECISIONS.md` and confirm with Zhongmin FIRST.
2. **Rule 6** — channel key names are frozen: `HG-R`, `HG-G`, `HG-B`,
   `HG-NIR`, `HG-Y`, `LG-R`, `LG-G`, `LG-B`, `LG-NIR`, `LG-Y`, `R`,
   `G`, `B`, `Y`, `L`. Renames break saved-lines JSON persistence.
3. **Rule 11** — never commit real H5 recordings. They're too big
   (multi-MB to GB) and the lab's data is not meant for the public
   repo.

## Workflow

### Phase 1 — scope

1. Identify which loaders / extractors are affected.
2. If the change introduces a new channel key, stop and go back to
   AGENT_RULES rule 6. The channel schema is a contract with the
   React frontend, the session store, and every figure builder.
3. If the change modifies the ISP mode registry, it's an
   `isp-modes-v<N>` initiative — use [`execplan-large-feature`](../execplan-large-feature/SKILL.md).

### Phase 2 — add synthetic fixture

```python
# tests/unit/test_<feature>.py
import numpy as np

def make_synth_h5(shape=(256, 512), seed=42):
    """Deterministic synthetic dual-gain frame."""
    rng = np.random.default_rng(seed)
    half = shape[1] // 2
    img_hg = 10000 + 5000 * np.sin(np.linspace(0, 8 * np.pi, shape[0] * half).reshape(shape[0], half))
    img_hg += rng.integers(-200, 200, size=(shape[0], half))
    img_lg = img_hg // 4 + rng.integers(0, 50, size=(shape[0], half))
    return np.concatenate([img_hg, img_lg], axis=1).astype(np.uint16)
```

Never use real H5 files in tests. Put real recordings in
`docs/validation/` (git-ignored staging) for manual verification
only.

### Phase 3 — edit the loader

Follow the existing dispatcher pattern in `load_any`. New format
detection goes in the `load_any` top-level `if/elif` chain. New ISP
mode goes in `isp_modes.MODES_V1` / the registry builder.

### Phase 4 — add unit test

- Schema test: assert every expected channel key is in the returned
  dict.
- Value test: assert a deterministic statistic (mean, std, checksum)
  on synthetic input matches an expected value. Record the expected
  value in the test.
- Dark-frame interaction: if the loader supports dark subtraction,
  test that `subtract_dark` produces the expected result.

### Phase 5 — run Tier 1 + Tier 2 + Tier 3

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest tests/unit/ -q
```

### Phase 6 — manually verify with a real sample

Load a real H5 via the UI and inspect the rendered frame in the
browser preview. Confirm channel counts +
dimensions are what you expect. If you're on the lab workstation,
also open the file in the full app:

```bash
python -m mantisanalysis "path/to/recording.h5"
```

### Phase 7 — update the contract docs

If channel list / shape changes:

- Update `.agent/ARCHITECTURE.md` — "Channel key schema" invariant.
- Update `README.md` — "Channel layout (GSense dual-gain)" section.
- Update `mantisanalysis/server.py` Pydantic models if the frontend
  sees the change.

### Phase 8 — invoke reviewers

- `test-coverage-reviewer` — synthetic + schema coverage adequate?
- `fastapi-backend-reviewer` — does the API still behave after the
  change? (Tier 3 smoke is already run, but the reviewer catches
  contract subtleties.)
- `risk-skeptic` — what happens with a corrupt / truncated /
  wrong-dtype input?

## Acceptance

- [ ] `tests/unit/test_bayer.py` (and any new test) green.
- [ ] Tier 1 + 2 + 3 + pytest green.
- [ ] No real H5 file in the commit.
- [ ] Channel schema invariant still holds (or explicit D-000N
  entry documents the change).
- [ ] Manually verified with a real sample (document filename +
  location in `Status.md`).

## Escalation

- Channel rename requested → stop, confirm with user, DECISIONS entry.
- Real recording needs to be used for verification → keep local;
  reference by path in `docs/validation/` staging, do not commit.
- GSense constants need to change → stop; AGENT_RULES rule 5 +
  Zhongmin approval required.
