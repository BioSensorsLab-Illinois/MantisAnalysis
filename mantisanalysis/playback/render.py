"""Single render entry — used by both preview-PNG and image/video export.

WYSIWYG invariant: ``render_view(stream, frame, view)`` returns the
PNG bytes that the export pipeline will burn into the output file.
There is no second code path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from .workspace import Stream, View


def render_view(stream: "Stream", frame: int, view: "View") -> bytes:
    """Return PNG bytes for the rendered view."""

    raise NotImplementedError("M5 will implement render_view()")
