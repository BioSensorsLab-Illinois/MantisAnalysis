---
name: performance-profiling
description: How to check responsiveness and rendering performance in MantisAnalysis. Browser DevTools, React Profiler concepts, server-side timing, and payload-size budgets.
when_to_use:
  - any change to data-heavy paths (live compute, analyze, export)
  - any canvas / image-processing change
  - a user report of lag or slow response
  - before closing an initiative that touched data/visualization/export
outputs:
  - measured numbers (input latency, render time, payload size)
  - findings vs. budget, recorded in Status.md
related_agents: performance-reviewer, frontend-react-engineer
---

# performance-profiling

## When to use

- Any change to a path under heavy interaction (drag, slider, live
  compute).
- Any change that widens or deepens response shape (new fields,
  bigger arrays).
- Any change to canvas / SVG / image composite work.
- Any export-pipeline change.
- Investigation after a user report.

## Budgets (MantisAnalysis)

| Path | Budget | Notes |
|---|---|---|
| Live compute endpoints (debounced) | < 100 KB response, < 200 ms round-trip on sample data | `/api/usaf/measure`, `/api/fpn/compute`, `/api/dof/compute` |
| Analyze endpoints | < 2 MB response, < 2 s round-trip | `/api/*/analyze` — invoked on modal open only |
| Thumbnail endpoint | < 200 KB PNG | `channel/*/thumbnail.png` |
| React re-render per user event | ≤ 3 component commits above 1 ms | measured with React Profiler |
| Input latency (drag, slider) | < 16 ms per frame | measured in Chrome Performance tab |
| Export PNG write | < 1 s for SVG-based charts; < 3 s for canvas composite | visible progress for > 1 s |

## Workflow

### Step 1 — frontend: input latency

1. Open the app in Chrome.
2. DevTools → Performance → Record.
3. Exercise the interaction (drag USAF line, drag FPN ROI, adjust
   slider).
4. Stop. Inspect the flame chart.
5. Look for long tasks > 50 ms in the Main thread during interaction.

Accept: scripting per frame < 16 ms on median; long tasks only
during API response assembly.

Common fixes:

- Debounce more aggressively (but debounce < 300 ms to keep
  interactive feel).
- Memoize expensive derivations (`useMemo`).
- Split a hot context so only the right subtree re-renders.

### Step 2 — frontend: re-render count

1. Install React DevTools extension (manual).
2. Profiler tab → Record.
3. Exercise the interaction.
4. Stop. Inspect commit count per component.

Accept: only components that actually need to reflect the change
commit. If a top-level App re-renders on a slider tick, that's a
failure.

### Step 3 — server: response time

```bash
python -m mantisanalysis --no-browser --port 8765 &
# Sample a live compute:
time curl -s -X POST http://127.0.0.1:8765/api/usaf/measure -H 'content-type: application/json' -d '{"source_id": "...", ...}' > /dev/null
```

Or add middleware timing in dev:

```python
# one-off instrumentation
import time
@app.middleware("http")
async def add_timing(request, call_next):
    t0 = time.time()
    r = await call_next(request)
    r.headers["x-server-time"] = f"{(time.time() - t0) * 1000:.1f}ms"
    return r
```

### Step 4 — server: payload size

```bash
curl -s -X POST http://127.0.0.1:8765/api/usaf/measure ... | wc -c
```

If a response is > 1 MB on a debounced endpoint, rethink the shape:
- Can any array be downsampled before serialization?
- Are profile arrays truncated to the useful range?
- Is PNG base64-embedding necessary, or could the frontend fetch the
  PNG separately on demand?

### Step 5 — network: waterfall

Chrome DevTools → Network. Open the relevant panel; interact. Look
for:

- Same resource requested N times — missing cache headers or state
  thrashing.
- Sequential requests that could be parallel — `Promise.all`.
- Unexpected cross-origin calls.

### Step 6 — memory

1. Open DevTools → Memory.
2. Take a heap snapshot before interaction.
3. Exercise the flow (load sample, switch mode, open analysis
   modal, export, close).
4. Take another heap snapshot.
5. Compare retained size by constructor. Growth > 50 MB per
   iteration = likely leak.

### Step 7 — export performance

For export buttons:

- Wall time from click → file written.
- Browser freeze during export? (blocking vs. async).
- Resulting file size at target DPI.

## Acceptance

- [ ] At least one measurement captured (number, not intuition).
- [ ] Findings mapped to budgets.
- [ ] Any regression has a proposed fix + re-measurement.

## Escalation

- Budget violated on a core flow → `performance-reviewer` pass; may
  need a separate initiative to fix.
- Memory leak confirmed → `risk-skeptic` pass; `R-00NN` entry.
- Canvas / WebGL required to hit budget → scope decision for user
  (big architectural change).
