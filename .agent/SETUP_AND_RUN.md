# SETUP_AND_RUN

Exact commands. Copy-paste, don't paraphrase.

## Supported platforms

- Windows 10/11, macOS 12+, Linux (any modern distro with a browser).
- Python **3.10, 3.11, 3.12, 3.13** (tested on 3.13).
- Any modern browser (Chrome / Firefox / Safari / Edge — any that
  can run React 18).

## First-time install (end user)

```bash
git clone https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git
cd MantisAnalysis
python -m pip install -e .
python -m mantisanalysis
```

The last line boots the FastAPI server at `http://127.0.0.1:8765` and
opens your default browser. Use the **⌘K** / **Ctrl+K** command
palette to load a sample or navigate; or click **Load sample** in the
top bar to fetch the bundled synthetic frame.

**Frontend bundler.** Source checkouts also need Node ≥ 20 + npm.
The React 18 SPA is bundled by Vite (post bundler-migration-v1
Phase 3). Bootstrap once, then build:

```bash
npm install         # first time only
npm run build       # emits web/dist/ — FastAPI serves it at /
```

If the dist isn't built, FastAPI's `/` returns a friendly
"build the frontend first" page instead of erroring. Pre-built
binaries (see "Standalone executable" in the README) bundle the
already-built dist so end users don't need Node.

## First-time install (developer)

```bash
git clone https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git
cd MantisAnalysis
python -m venv .venv                  # optional but recommended
source .venv/bin/activate             # macOS / Linux
# or: .\.venv\Scripts\activate        # Windows PowerShell

python -m pip install -e .[dev]       # runtime + pytest + ruff + mypy + httpx
```

### Optional: Playwright browser smoke

```bash
python -m pip install -e .[web-smoke]
playwright install chromium
```

~300 MB chromium download. Only needed if you'll run the opt-in
Tier-4 browser smoke (`pytest -m web_smoke`).

### Vite toolchain (required post bundler-migration-v1 Phase 3)

The frontend is now Vite-bundled — the CDN + Babel-standalone path
is gone. Source checkouts must run `npm run build` before FastAPI
will serve the real SPA (otherwise `/` returns a friendly
"build the frontend first" page).

```bash
# Requires Node >= 20 + npm (engines field in package.json).
npm install                    # one-time
npm run build                  # production bundle to web/dist/  (do this once)
npm run dev                    # optional: HMR dev server on :5173 with /api proxy
npm run preview                # optional: preview the built bundle on :4173
```

`scripts/doctor.py`'s Node check is FAIL-level — without Node the
SPA cannot be built or served.

## Run the app

```bash
# Default — boot server, open browser:
python -m mantisanalysis
mantisanalysis                                 # same, via pip-installed entry point

# Preload a recording:
python -m mantisanalysis path/to/recording.h5
python -m mantisanalysis --dark path/to/image.png

# Server-only (no browser auto-open — useful for agents / tests):
python -m mantisanalysis --no-browser

# Custom port:
python -m mantisanalysis --port 9001

# Windows / macOS double-click launchers (in repo root):
MantisAnalysis.bat        # Windows Explorer
MantisAnalysis.command    # macOS Finder
```

After boot:

- Root UI: `http://127.0.0.1:8765/`
- FastAPI interactive docs: `http://127.0.0.1:8765/api/docs`
- Health probe: `http://127.0.0.1:8765/api/health`

Close with `Ctrl+C` in the launching terminal.

## Run the legacy Workflow A CLI (auto-strip FFT MTF)

```bash
python scripts/run_usaf_resolution.py path/to/h5 [out-dir]
```

Orthogonal to the web app; produces per-gain panel + overlay +
summary PNGs. Decision re: long-term fate pending — see
[`DECISIONS.md`](DECISIONS.md) D-0004.

## Test commands

```bash
# Pure unit tests (no display, no server):
python -m pytest tests/unit/ -q

# Headless figure-builder tests (matplotlib Agg):
python -m pytest tests/headless/ -q

# All default tests:
python -m pytest -q

# Playwright browser smoke (opt-in, needs web-smoke extra):
pytest -m web_smoke -q
```

## Smoke tiers

The blessed gate before claiming any non-doc change complete. See
[`QUALITY_GATES.md`](QUALITY_GATES.md) for what each tier covers and
which are mandatory per change type.

```bash
python scripts/smoke_test.py --tier 0    # agent-doc consistency, ~0.5 s
python scripts/smoke_test.py --tier 1    # imports, ~1 s
python scripts/smoke_test.py --tier 2    # headless figures, ~3-5 s
python scripts/smoke_test.py --tier 3    # FastAPI TestClient, ~2-4 s
python scripts/smoke_test.py --tier 4    # pointer to the Playwright gate
```

Tier 2 writes sample figure PNGs into `outputs/smoke/`.
Tier 4 is wired via `pytest -m web_smoke` — see above.

## Lint, format, type-check

```bash
python -m ruff check mantisanalysis scripts tests
python -m ruff format mantisanalysis scripts tests    # rewrite
python -m ruff format --check mantisanalysis scripts tests   # dry-run
python -m mypy mantisanalysis                          # progressive; warnings expected
```

Ruff config is conservative (see `pyproject.toml [tool.ruff]`) — it
does not auto-refactor existing code style.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'mantisanalysis'` | `cd` into the repo root, or `pip install -e .`. |
| Browser opens to a blank page | Check server log for Python errors. React mount needs `/api/health` to respond; test with `curl http://127.0.0.1:8765/api/health`. |
| Port 8765 already in use | `python -m mantisanalysis --port 9001` (or kill the other process). |
| `playwright` imports fail in tests/web | `pip install -e .[web-smoke]` + `playwright install chromium`. |
| Tier-2 smoke writes but images look empty | Check matplotlib ≥ 3.7. |
| Tier-0 smoke flags drift after your doc edit | Either fix the drift or enclose the historical reference in an `qt-allowed` HTML comment block pair. See [`scripts/check_agent_docs.py`](../scripts/check_agent_docs.py) for the exact marker syntax. |
| `/api/*` returns 404 unexpectedly | The React app probably cached a stale `source_id` after a server restart. Reload the page. |
| FastAPI session store LRU evicted a source | Reload the page; the React app re-registers sources after a fresh boot. Sources don't survive process restarts. |

For React-layer issues, follow the
[`UI_VERIFICATION.md`](UI_VERIFICATION.md) ladder.
