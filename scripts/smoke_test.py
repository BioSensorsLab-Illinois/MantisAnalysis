"""MantisAnalysis smoke-test runner.

Tiers
-----
0. Agent-doc consistency — delegates to scripts/check_agent_docs.py.
   Scans .agent/*.md + CLAUDE.md + AGENTS.md for stale PySide/Qt claims
   and broken command references. No Python imports required from the
   product package.
1. Imports — every package module imports without error. No display required.
2. Headless figures — every figure builder produces a `matplotlib.Figure`
   when fed synthetic data (matplotlib Agg backend).
3. Server — spins up the FastAPI app with fastapi.testclient and exercises
   the core endpoints end-to-end (sample load → channel thumbnail → USAF
   measure → FPN compute → DoF compute). No external process required.
4. End-to-end — opt-in real browser automation via Playwright.
   See tests/web/test_web_boot.py and [project.optional-dependencies].web-smoke.
   Invoked separately via `pytest -m web_smoke`; not run by `--tier 4` here.

Usage
-----
    python scripts/smoke_test.py --tier 0       # docs consistency
    python scripts/smoke_test.py --tier 1       # imports
    python scripts/smoke_test.py --tier 2       # headless figures
    python scripts/smoke_test.py --tier 3       # FastAPI TestClient
    python scripts/smoke_test.py --tier 4       # placeholder (see pytest -m web_smoke)

Exit codes: 0 = pass, non-zero = failed (specific tier failure printed).
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

# Make sibling package importable when running the script directly.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Tier 0 — agent-doc consistency


def tier0() -> tuple[bool, str]:
    """Run the four agent-harness consistency checks as subprocesses.

    - check_agent_docs.py       — Qt drift + dead commands + manifest + xrefs.
    - check_skill_frontmatter.py — every SKILL.md frontmatter is valid.
    - check_stopping_criteria.py — active initiatives are coherent; closed
                                   initiatives have a Final verification block.
    - check_reviewer_evidence.py — reviewer findings tables have matching
                                   report files under .agent/runs/<slug>/reviews/.

    Mirrors each exit status; any fails are printed.
    """
    import subprocess

    checks = [
        ("check_agent_docs", ["scripts/check_agent_docs.py"]),
        ("check_skill_frontmatter", ["scripts/check_skill_frontmatter.py"]),
        ("check_stopping_criteria", ["scripts/check_stopping_criteria.py", "--all"]),
        ("check_reviewer_evidence", ["scripts/check_reviewer_evidence.py", "--all"]),
        ("check_frontend_lint", ["scripts/check_frontend_lint.py"]),
    ]
    outputs: list[str] = []
    failed = False
    for name, argv in checks:
        script = ROOT / argv[0]
        if not script.is_file():
            outputs.append(f"{name}: missing at {script.relative_to(ROOT)}")
            failed = True
            continue
        try:
            proc = subprocess.run(
                [sys.executable, *argv],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            outputs.append(f"{name}: timed out after 30 s")
            failed = True
            continue
        if proc.returncode != 0:
            outputs.append(f"[{name}] FAIL:\n{proc.stdout}{proc.stderr}")
            failed = True
            continue
        # Collect the last non-empty line as a concise status.
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        outputs.append(f"[{name}] {lines[-1] if lines else 'OK'}")
    summary = "\n".join(outputs)
    return (not failed), summary


# ---------------------------------------------------------------------------
# Tier 1 — imports


def tier1() -> tuple[bool, str]:
    """Every package + submodule imports cleanly."""
    modules = [
        "mantisanalysis",
        "mantisanalysis.app",
        "mantisanalysis.extract",
        "mantisanalysis.figures",
        "mantisanalysis.image_io",
        "mantisanalysis.image_processing",
        "mantisanalysis.usaf_groups",
        "mantisanalysis.usaf_render",
        "mantisanalysis.fpn_analysis",
        "mantisanalysis.fpn_render",
        "mantisanalysis.dof_analysis",
        "mantisanalysis.dof_render",
        "mantisanalysis.resolution",
        "mantisanalysis.server",
        "mantisanalysis.session",
    ]
    failures = []
    for m in modules:
        try:
            __import__(m)
        except Exception as exc:
            failures.append(f"  {m}: {type(exc).__name__}: {exc}")
    if failures:
        return False, "Import failures:\n" + "\n".join(failures)
    return True, f"OK — {len(modules)} modules imported."


# ---------------------------------------------------------------------------
# Tier 2 — headless figures


def tier2() -> tuple[bool, str]:
    """Every figure builder runs against synthetic data and returns a Figure."""
    import matplotlib

    matplotlib.use("Agg")  # MUST come before any pyplot import
    import numpy as np

    out_dir = ROOT / "outputs" / "smoke"
    out_dir.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []

    # Synthetic dual-gain GSense frame: 256x512 (HG | LG halves).
    rng = np.random.default_rng(seed=42)
    half = 256
    img_hg = (
        10000
        + 5000 * np.sin(np.linspace(0, 8 * np.pi, half * half)).reshape(half, half)
        + rng.integers(-200, 200, size=(half, half))
    ).astype(np.uint16)
    img_lg = (img_hg // 4 + rng.integers(0, 50, size=(half, half))).astype(np.uint16)
    channel_images = {
        "HG-R": img_hg,
        "HG-G": img_hg,
        "HG-B": img_hg,
        "HG-NIR": img_hg,
        "HG-Y": img_hg,
        "LG-R": img_lg,
        "LG-G": img_lg,
        "LG-B": img_lg,
        "LG-NIR": img_lg,
        "LG-Y": img_lg,
    }

    # ---- USAF ----
    try:
        from mantisanalysis.usaf_groups import LineSpec
        from mantisanalysis.usaf_render import build_analysis_figures

        specs = [
            LineSpec(group=2, element=3, direction="H", p0=(80, 80), p1=(110, 80)),
            LineSpec(group=2, element=3, direction="V", p0=(120, 80), p1=(120, 110)),
        ]
        figs = build_analysis_figures(
            channel_images,
            specs,
            mode="rgb",
            transform={"rotation": 0, "flip_h": False, "flip_v": False},
            threshold=0.2,
        )
        if not figs:
            failures.append("USAF build_analysis_figures returned no figures")
        for i, fig in enumerate(figs):
            fig.savefig(out_dir / f"smoke_usaf_{i}.png", dpi=80, bbox_inches="tight")
    except Exception:
        failures.append("USAF build_analysis_figures crashed:\n" + traceback.format_exc())

    # ---- FPN ----
    try:
        from mantisanalysis.fpn_analysis import (
            FPNSettings,
            compute_fpn,
            compute_fpn_multi,
            compute_prnu_stability,
        )
        from mantisanalysis.fpn_render import (
            build_autocorr_fig,
            build_hotpix_fig,
            build_map_fig,
            build_overview_fig,
            build_psd1d_fig,
            build_psd_fig,
            build_rowcol_fig,
        )

        res = compute_fpn(
            img_hg,
            name="HG-R",
            roi=(40, 40, 120, 120),
            settings=FPNSettings(median_size=3, drift_order="bilinear", hot_sigma=4.0),
        )
        for nm, fn in (
            ("overview", build_overview_fig),
            ("rowcol", build_rowcol_fig),
            ("map", build_map_fig),
            ("psd", build_psd_fig),
            ("autocorr", build_autocorr_fig),
            ("psd1d", build_psd1d_fig),
            ("hotpix", build_hotpix_fig),
        ):
            fig = fn(res, fig_face="#ffffff", text="#1f2328")
            fig.savefig(out_dir / f"smoke_fpn_{nm}.png", dpi=80, bbox_inches="tight")
        # Multi-ROI + PRNU stability curve should also survive.
        multi = compute_fpn_multi(
            img_hg,
            name="HG-R",
            rois=[(40, 40, 120, 120), (120, 120, 200, 200)],
            settings=FPNSettings(drift_order="bilinear"),
        )
        if len(multi) != 2:
            failures.append(f"compute_fpn_multi returned {len(multi)} results")
        stab = compute_prnu_stability(img_hg, roi=(40, 40, 200, 200), n_shrinks=4)
        if len(stab) != 4 or any("prnu_pct" not in s for s in stab):
            failures.append(f"compute_prnu_stability malformed: {stab}")
    except Exception:
        failures.append("FPN figure build crashed:\n" + traceback.format_exc())

    # ---- DoF ----
    try:
        from mantisanalysis.dof_analysis import (
            DoFPoint,
            analyze_dof,
            analyze_dof_multi,
            compute_dof_stability,
            fit_focus_plane,
        )
        from mantisanalysis.dof_render import (
            build_chromatic_shift_fig,
            build_gaussian_fit_fig,
            build_heatmap_fig,
            build_line_scan_fig,
            build_metric_compare_fig,
            build_points_fig,
            build_tilt_plane_fig,
        )

        res = analyze_dof(
            img_hg,
            name="HG-R",
            points=[
                DoFPoint(x=60, y=60, label="a"),
                DoFPoint(x=180, y=180, label="b"),
                DoFPoint(x=80, y=160, label="c"),
            ],
            lines=[((40, 80), (200, 80))],
            metric="laplacian",
            half_window=16,
            build_heatmap=True,
            heatmap_step=64,
            compute_all_metrics=True,
            bootstrap=True,
            n_boot=80,
            fit_tilt_plane=True,
        )
        for nm, fn in (
            ("heatmap", build_heatmap_fig),
            ("line", build_line_scan_fig),
            ("points", build_points_fig),
            ("gaussian", build_gaussian_fit_fig),
            ("tilt", build_tilt_plane_fig),
        ):
            fig = fn(res, fig_face="#ffffff", text="#1f2328")
            fig.savefig(out_dir / f"smoke_dof_{nm}.png", dpi=80, bbox_inches="tight")
        fig = build_metric_compare_fig(res, img_hg, fig_face="#ffffff", text="#1f2328")
        fig.savefig(out_dir / "smoke_dof_metric_compare.png", dpi=80, bbox_inches="tight")
        # Multi-channel chromatic shift
        multi = analyze_dof_multi(
            {"HG-R": img_hg, "HG-G": img_hg, "HG-B": img_lg},
            points=[],
            lines=[((40, 80), (200, 80))],
            metric="laplacian",
            half_window=16,
            build_heatmap=False,
        )
        fig = build_chromatic_shift_fig(multi, fig_face="#ffffff", text="#1f2328")
        fig.savefig(out_dir / "smoke_dof_chromatic.png", dpi=80, bbox_inches="tight")
        # Stability curve
        stab = compute_dof_stability(
            img_hg,
            p0=(40, 80),
            p1=(200, 80),
            metric="laplacian",
            threshold=0.5,
            windows=(12, 24, 48),
        )
        if len(stab) != 3:
            failures.append(f"compute_dof_stability returned {len(stab)}")
        # Tilt plane helper
        plane = fit_focus_plane(res.points)
        if plane is None or "r_squared" not in plane:
            failures.append(f"fit_focus_plane returned {plane}")
    except Exception:
        failures.append("DoF figure build crashed:\n" + traceback.format_exc())

    if failures:
        return False, "\n\n".join(failures)
    return True, f"OK — figures written to {out_dir.relative_to(ROOT)}/"


# ---------------------------------------------------------------------------
# Tier 3 — FastAPI server round-trip


def tier3() -> tuple[bool, str]:
    """Boot the ASGI app in-process and exercise the key endpoints."""
    try:
        from fastapi.testclient import TestClient
    except Exception as exc:
        return False, (f"TestClient import failed: {exc}. Install dev deps: pip install httpx")

    try:
        from mantisanalysis.server import app
        from mantisanalysis.session import STORE
    except Exception as exc:
        return False, f"server import failed: {type(exc).__name__}: {exc}"

    STORE.clear()
    client = TestClient(app)

    # Health
    r = client.get("/api/health")
    if r.status_code != 200:
        return False, f"/api/health -> {r.status_code}"
    if not r.json().get("ok"):
        return False, f"/api/health unhealthy: {r.text}"

    # Sample source
    r = client.post("/api/sources/load-sample")
    if r.status_code != 200:
        return False, f"/api/sources/load-sample -> {r.status_code} :: {r.text}"
    src = r.json()
    sid = src["source_id"]
    if not src["channels"]:
        return False, "sample source has no channels"

    # Thumbnail
    ch = "HG-G" if "HG-G" in src["channels"] else src["channels"][0]
    r = client.get(f"/api/sources/{sid}/channel/{ch}/thumbnail.png")
    if r.status_code != 200:
        return False, f"thumbnail -> {r.status_code} :: {r.text[:200]}"
    if r.headers.get("content-type") != "image/png":
        return False, f"thumbnail content-type is {r.headers.get('content-type')}"

    # USAF measure
    r = client.post(
        "/api/usaf/measure",
        json={
            "source_id": sid,
            "channel": ch,
            "line": {
                "group": 2,
                "element": 3,
                "direction": "H",
                "p0": [80, 80],
                "p1": [150, 80],
            },
        },
    )
    if r.status_code != 200:
        return False, f"/api/usaf/measure -> {r.status_code} :: {r.text[:200]}"
    m = r.json()
    for key in ("lp_mm", "modulation", "modulation_pct", "reliability"):
        if key not in m:
            return False, f"usaf measure missing {key!r}: {m}"

    # FPN compute — small-payload live summary
    r = client.post(
        "/api/fpn/compute",
        json={
            "source_id": sid,
            "channel": ch,
            "roi": [40, 40, 200, 200],
            "settings": {"median_size": 3, "drift_order": "bilinear", "hot_sigma": 4.0},
        },
    )
    if r.status_code != 200:
        return False, f"/api/fpn/compute -> {r.status_code} :: {r.text[:200]}"
    fpn = r.json()
    if fpn.get("std", 0.0) <= 0.0:
        return False, f"fpn std non-positive: {fpn}"
    for key in (
        "mean_signal",
        "dsnu_row_only_dn",
        "dsnu_col_only_dn",
        "row_peak_freq",
        "col_peak_freq",
        "hot_pixel_count",
        "cold_pixel_count",
        "drift_order",
    ):
        if key not in fpn:
            return False, f"fpn compute missing new field {key!r}: {fpn}"

    # FPN measure — rich payload with arrays
    r = client.post(
        "/api/fpn/measure",
        json={
            "source_id": sid,
            "channel": ch,
            "roi": [40, 40, 200, 200],
            "settings": {"drift_order": "bilinear"},
        },
    )
    if r.status_code != 200:
        return False, f"/api/fpn/measure -> {r.status_code} :: {r.text[:200]}"
    fpn_rich = r.json()
    for key in (
        "row_means",
        "col_means",
        "row_psd",
        "col_psd",
        "row_freq",
        "col_freq",
        "top_hot",
        "top_cold",
        "settings",
    ):
        if key not in fpn_rich:
            return False, f"fpn measure missing {key!r}"
    if not isinstance(fpn_rich["row_means"], list):
        return False, "row_means is not a list"

    # FPN measure_batch (multi-ROI)
    r = client.post(
        "/api/fpn/measure_batch",
        json={
            "source_id": sid,
            "channel": ch,
            "rois": [[40, 40, 120, 120], [120, 120, 200, 200]],
            "settings": {},
        },
    )
    if r.status_code != 200:
        return False, f"/api/fpn/measure_batch -> {r.status_code}"
    batch = r.json()
    if len(batch.get("rois", [])) != 2:
        return False, f"fpn batch expected 2 rois, got {batch}"

    # FPN stability
    r = client.post(
        "/api/fpn/stability",
        json={
            "source_id": sid,
            "channel": ch,
            "roi": [40, 40, 200, 200],
            "n_shrinks": 4,
            "settings": {},
        },
    )
    if r.status_code != 200:
        return False, f"/api/fpn/stability -> {r.status_code}"
    if len(r.json().get("curve", [])) != 4:
        return False, "stability curve length != 4"

    # FPN analyze (multi-channel × multi-ROI native JSON + PNGs)
    r = client.post(
        "/api/fpn/analyze",
        json={
            "source_id": sid,
            "channels": [ch],
            "rois": [[40, 40, 200, 200]],
            "settings": {"drift_order": "bilinear"},
            "include_pngs": True,
        },
    )
    if r.status_code != 200:
        return False, f"/api/fpn/analyze -> {r.status_code} :: {r.text[:200]}"
    ana = r.json()
    if ch not in ana.get("measurements", {}):
        return False, f"fpn analyze missing measurements for {ch}"
    if ch not in (ana.get("figures") or {}):
        return False, f"fpn analyze missing figures for {ch}"

    # DoF compute — legacy lean path
    r = client.post(
        "/api/dof/compute",
        json={
            "source_id": sid,
            "channel": ch,
            "points": [{"x": 100, "y": 100, "label": "a"}],
            "lines": [{"p0": [40, 80], "p1": [200, 80]}],
            "metric": "laplacian",
        },
    )
    if r.status_code != 200:
        return False, f"/api/dof/compute -> {r.status_code} :: {r.text[:200]}"
    dof = r.json()
    if not dof.get("lines"):
        return False, f"dof lines missing: {dof}"
    # dof-rewrite-v1: gaussian field should be present even in lean mode
    if "gaussian" not in dof["lines"][0]:
        return False, "dof lines[0].gaussian missing"

    # DoF compute — rich mode with all-metrics + bootstrap + tilt plane
    r = client.post(
        "/api/dof/compute",
        json={
            "source_id": sid,
            "channel": ch,
            "points": [
                {"x": 60, "y": 60, "label": "a"},
                {"x": 180, "y": 60, "label": "b"},
                {"x": 120, "y": 180, "label": "c"},
            ],
            "lines": [{"p0": [40, 80], "p1": [300, 80]}],
            "metric": "laplacian",
            "half_window": 24,
            "threshold": 0.5,
            "compute_all_metrics": True,
            "bootstrap": True,
            "n_boot": 80,
            "fit_tilt_plane": True,
        },
    )
    if r.status_code != 200:
        return False, f"/api/dof/compute rich -> {r.status_code} :: {r.text[:200]}"
    dof_rich = r.json()
    line = dof_rich["lines"][0]
    for key in ("gaussian", "peak_ci95_px", "dof_width_ci95_px", "metric_sweep"):
        if key not in line:
            return False, f"dof rich line missing {key!r}"
    if dof_rich.get("tilt_plane") is None:
        return False, "dof rich tilt_plane missing"

    # DoF stability
    r = client.post(
        "/api/dof/stability",
        json={
            "source_id": sid,
            "channel": ch,
            "p0": [40, 80],
            "p1": [300, 80],
            "metric": "laplacian",
            "threshold": 0.5,
            "windows": [12, 24, 48],
        },
    )
    if r.status_code != 200:
        return False, f"/api/dof/stability -> {r.status_code}"
    if len(r.json().get("curve", [])) != 3:
        return False, "dof stability curve length != 3"

    # DoF analyze (multi-channel)
    r = client.post(
        "/api/dof/analyze",
        json={
            "source_id": sid,
            "channels": [ch],
            "points": [
                {"x": 120, "y": 120, "label": "a"},
                {"x": 200, "y": 200, "label": "b"},
                {"x": 160, "y": 80, "label": "c"},
            ],
            "lines": [{"p0": [40, 120], "p1": [300, 120]}],
            "metric": "laplacian",
            "half_window": 24,
            "threshold": 0.5,
            "include_pngs": True,
        },
    )
    if r.status_code != 200:
        return False, f"/api/dof/analyze -> {r.status_code} :: {r.text[:200]}"
    ana = r.json()
    if ch not in (ana.get("results") or {}):
        return False, f"dof analyze missing result for {ch}"
    if ch not in (ana.get("figures") or {}):
        return False, f"dof analyze missing figures for {ch}"

    return True, "OK — FastAPI endpoints exercised end-to-end."


# ---------------------------------------------------------------------------
# Tier 4 — placeholder


def tier4() -> tuple[bool, str]:
    return False, (
        "Tier 4 real-browser smoke is wired via Playwright in tests/web/. "
        "Run with: pip install -e '.[web-smoke]' && playwright install chromium && "
        "pytest -m web_smoke -q"
    )


TIERS = {0: tier0, 1: tier1, 2: tier2, 3: tier3, 4: tier4}


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--tier", type=int, default=1, choices=[0, 1, 2, 3, 4])
    args = p.parse_args()
    tier = args.tier
    print(f"=== MantisAnalysis smoke — tier {tier} ===")
    fn = TIERS[tier]
    ok, msg = fn()
    print(msg)
    print(f"=== tier {tier}: {'PASS' if ok else 'FAIL'} ===")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
