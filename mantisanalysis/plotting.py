"""Shared matplotlib plotting helpers used by the render modules.

These used to live in ``fpn_render.py`` and were reached for from
``dof_render.py`` (and ``dof_analysis.py``) via a cross-module import.
The coupling was tracked as R-0007 and scheduled for hoisting in
B-0005 / B-0016; this module is that hoist.

Pure matplotlib — no Qt, no FastAPI. Safe to import from anywhere.
"""

from __future__ import annotations


CHANNEL_COLORS = {
    "R":   "#d62728",
    "G":   "#2ca02c",
    "B":   "#1f77b4",
    "NIR": "#7f7f7f",
    "Y":   "#000000",
    "L":   "#000000",
}


def _ch(name: str) -> str:
    """Strip the gain prefix from a channel key (``HG-R`` → ``R``)."""
    return name.split("-")[-1] if "-" in name else name


def _color(name: str) -> str:
    """Map a channel key (``HG-R``, ``LG-NIR``, ``R``, …) to a hex color."""
    return CHANNEL_COLORS.get(_ch(name), "#444444")


def _style_axes(ax, fig_face, text) -> None:
    """Apply theme-aware tick / spine / face colors to a matplotlib axes."""
    ax.tick_params(colors=text)
    for sp in ax.spines.values():
        sp.set_color(text)
    ax.set_facecolor(fig_face)
