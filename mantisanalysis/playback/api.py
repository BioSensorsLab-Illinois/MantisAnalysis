"""FastAPI surface for Playback. Thin — most logic is in workspace.py.

Routes (target ~10 total):

* ``GET    /api/playback/workspace``       — full state snapshot
* ``GET    /api/playback/events``          — SSE event stream
* ``POST   /api/playback/recordings``      — register a recording (multipart upload OR path)
* ``DELETE /api/playback/recordings/{id}`` — cascade-delete
* ``POST   /api/playback/darks``           — register a dark frame
* ``DELETE /api/playback/darks/{id}``
* ``POST   /api/playback/streams``         — build a stream from rec_ids
* ``DELETE /api/playback/streams/{id}``
* ``POST   /api/playback/tabs``            — open a tab on a stream
* ``DELETE /api/playback/tabs/{id}``
* ``GET    /api/playback/tabs/{id}/frame.png`` — preview PNG (uses render.py)
* ``POST   /api/playback/exports/image``   — image export (uses render.py)
* ``POST   /api/playback/exports/video``   — video export (uses render.py)
"""

from __future__ import annotations

from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from fastapi import FastAPI


def mount(app: "FastAPI") -> None:
    """Register Playback routes on a FastAPI app."""

    raise NotImplementedError("M1 will implement mount()")
