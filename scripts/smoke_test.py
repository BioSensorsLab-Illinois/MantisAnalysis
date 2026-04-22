"""MantisAnalysis smoke-test runner.

Tiers
-----
1. Imports — every package module imports without error. No display required.
2. Headless figures — every figure builder produces a `matplotlib.Figure`
   when fed synthetic data (matplotlib Agg backend). No display required.
3. Qt boot — `mantisanalysis.app.main` launches a `QApplication` + `MainWindow`,
   posts a quit timer, and exits 0. Requires a display (or virtual display
   via xvfb-run on Linux CI).
4. End-to-end — programmatically pick lines / ROI / points in each mode and
   invoke Run analysis to verify the analysis windows construct figures.
   Currently a stub; flesh out under .agent/runs/.

Usage
-----
    python scripts/smoke_test.py --tier 1
    python scripts/smoke_test.py --tier 2
    python scripts/smoke_test.py --tier 3       # opens a real window briefly
    python scripts/smoke_test.py --tier 4       # not yet implemented

Exit codes: 0 = pass, non-zero = failed (specific tier failure printed).
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path
from typing import List, Tuple

# Make sibling package importable when running the script directly.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Tier 1 — imports

def tier1() -> Tuple[bool, str]:
    """Every package + submodule imports cleanly."""
    modules = [
        "mantisanalysis",
        "mantisanalysis.app",
        "mantisanalysis.extract",
        "mantisanalysis.image_io",
        "mantisanalysis.image_processing",
        "mantisanalysis.usaf_groups",
        "mantisanalysis.usaf_render",
        "mantisanalysis.fpn_analysis",
        "mantisanalysis.fpn_render",
        "mantisanalysis.dof_analysis",
        "mantisanalysis.dof_render",
        "mantisanalysis.modes.common",
        "mantisanalysis.modes.fpn",
        "mantisanalysis.modes.dof",
        "mantisanalysis.resolution",
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

def tier2() -> Tuple[bool, str]:
    """Every figure builder runs against synthetic data and returns a Figure."""
    import matplotlib
    matplotlib.use("Agg")  # MUST come before any pyplot import
    import matplotlib.pyplot as plt  # noqa: F401  (sanity)
    import numpy as np

    out_dir = ROOT / "outputs" / "smoke"
    out_dir.mkdir(parents=True, exist_ok=True)

    failures: List[str] = []

    # Build a synthetic dual-gain GSense-shaped frame: 256x512 (HG | LG halves).
    rng = np.random.default_rng(seed=42)
    half = 256
    img_hg = (10000 + 5000 * np.sin(np.linspace(0, 8 * np.pi, half * half)).reshape(half, half)
              + rng.integers(-200, 200, size=(half, half))).astype(np.uint16)
    img_lg = (img_hg // 4 + rng.integers(0, 50, size=(half, half))).astype(np.uint16)
    full = np.concatenate([img_hg, img_lg], axis=1)
    channel_images = {
        "HG-R": img_hg, "HG-G": img_hg, "HG-B": img_hg, "HG-NIR": img_hg, "HG-Y": img_hg,
        "LG-R": img_lg, "LG-G": img_lg, "LG-B": img_lg, "LG-NIR": img_lg, "LG-Y": img_lg,
    }

    # ---- USAF figure builders ----
    try:
        from mantisanalysis.usaf_groups import LineSpec
        from mantisanalysis.usaf_render import build_analysis_figures
        specs = [LineSpec(group=2, element=3, direction="H", p0=(80, 80), p1=(110, 80)),
                 LineSpec(group=2, element=3, direction="V", p0=(120, 80), p1=(120, 110))]
        figs = build_analysis_figures(channel_images, specs, mode="rgb",
                                      transform={"rotation": 0, "flip_h": False, "flip_v": False},
                                      threshold=0.2)
        if not figs:
            failures.append("USAF build_analysis_figures returned no figures")
        for i, fig in enumerate(figs):
            fig.savefig(out_dir / f"smoke_usaf_{i}.png", dpi=80, bbox_inches="tight")
    except Exception:
        failures.append("USAF build_analysis_figures crashed:\n" + traceback.format_exc())

    # ---- FPN figure builders ----
    try:
        from mantisanalysis.fpn_analysis import compute_fpn, FPNSettings
        from mantisanalysis.fpn_render import (
            build_overview_fig, build_rowcol_fig, build_map_fig, build_psd_fig
        )
        res = compute_fpn(img_hg, name="HG-R",
                          roi=(40, 40, 120, 120),
                          settings=FPNSettings(median_size=3))
        for nm, fn in (("overview", build_overview_fig),
                       ("rowcol",   build_rowcol_fig),
                       ("map",      build_map_fig),
                       ("psd",      build_psd_fig)):
            fig = fn(res, fig_face="#ffffff", text="#1f2328")
            fig.savefig(out_dir / f"smoke_fpn_{nm}.png", dpi=80, bbox_inches="tight")
    except Exception:
        failures.append("FPN figure build crashed:\n" + traceback.format_exc())

    # ---- DoF figure builders ----
    try:
        from mantisanalysis.dof_analysis import analyze_dof, DoFPoint
        from mantisanalysis.dof_render import (
            build_heatmap_fig, build_line_scan_fig, build_points_fig
        )
        res = analyze_dof(img_hg, name="HG-R",
                          points=[DoFPoint(x=60, y=60, label="a"),
                                  DoFPoint(x=180, y=180, label="b")],
                          lines=[((40, 80), (200, 80))],
                          metric="laplacian", half_window=16,
                          build_heatmap=True, heatmap_step=64)
        for nm, fn in (("heatmap", build_heatmap_fig),
                       ("line",    build_line_scan_fig),
                       ("points",  build_points_fig)):
            fig = fn(res, fig_face="#ffffff", text="#1f2328")
            fig.savefig(out_dir / f"smoke_dof_{nm}.png", dpi=80, bbox_inches="tight")
    except Exception:
        failures.append("DoF figure build crashed:\n" + traceback.format_exc())

    if failures:
        return False, "\n\n".join(failures)
    return True, f"OK — figures written to {out_dir.relative_to(ROOT)}/"


# ---------------------------------------------------------------------------
# Tier 3 — Qt boot

def tier3() -> Tuple[bool, str]:
    """Boot QApplication + MainWindow, schedule a quit, exit 0 on success."""
    try:
        from PySide6 import QtCore, QtWidgets
    except Exception as exc:
        return False, f"PySide6 import failed: {exc}"

    # Lazy import to avoid Qt during pure tier-1
    from mantisanalysis.app import _bootstrap_legacy_entry
    pick = _bootstrap_legacy_entry()

    # Check apply_theme/MainWindow/THEMES exist
    for symbol in ("MainWindow", "apply_theme", "THEMES", "main"):
        if not hasattr(pick, symbol):
            return False, f"pick_lines_gui missing symbol {symbol!r}"

    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv)
    app.setStyle("Fusion")
    pick.apply_theme(app, "light")
    win = pick.MainWindow(theme_name="light", initial_path=None)
    win.show()

    # Quit after 1.0s
    QtCore.QTimer.singleShot(1000, app.quit)
    rc = app.exec()
    return (rc == 0), f"QApplication exit code = {rc}"


# ---------------------------------------------------------------------------
# Tier 4 — placeholder

def tier4() -> Tuple[bool, str]:
    return False, "Tier 4 not yet implemented (see .agent/BACKLOG.md)."


# ---------------------------------------------------------------------------
# Driver

TIERS = {1: tier1, 2: tier2, 3: tier3, 4: tier4}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tier", type=int, default=1, choices=[1, 2, 3, 4])
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
