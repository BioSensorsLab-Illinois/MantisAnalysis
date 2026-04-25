"""Workspace — user-mutable Streams + Tabs built on top of Library.

Cascade rules live here in one place. The bug class from playback v1
("zombie streams after delete_recording") is fixed by construction:

* ``library.delete_recording(rec_id)`` walks every stream that
  references ``rec_id``.
* If the stream was single-recording, it is **deleted**, and any tab
  pointing at it is **closed**.
* If multi-recording, the rec is dropped, boundaries are rebuilt,
  active frames are clamped, the tab survives.
* Frame-LRU entries for the recording are dropped.
* One ``library.recording.deleted`` event captures all of it; the
  frontend diffs on the event payload instead of guessing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional


Layout = Literal["single", "side", "stack", "2x2", "3plus1"]


@dataclass
class View:
    view_id: str
    name: str = "View"
    type: Literal["single", "rgb", "overlay"] = "single"
    channel: str = "HG-G"
    channels: List[str] = field(default_factory=lambda: ["HG-R", "HG-G", "HG-B"])
    locked_frame: Optional[int] = None
    sync_to_global: bool = True
    export_include: bool = True

    dark_on: bool = False
    dark_id: Optional[str] = None
    gain: float = 1.0
    offset: float = 0.0
    normalize: bool = False

    low: int = 30
    high: int = 900
    colormap: str = "viridis"
    invert: bool = False
    show_clipped: bool = False


@dataclass
class Stream:
    stream_id: str
    name: str
    rec_ids: List[str]
    fps_override: Optional[float] = None


@dataclass
class Tab:
    tab_id: str
    stream_id: str
    layout: Layout = "single"
    views: List[View] = field(default_factory=list)
    active_frame: int = 0
    selected_view_id: Optional[str] = None


class Workspace:
    """Process-global workspace — one per server."""

    def __init__(self) -> None:
        self._streams: Dict[str, Stream] = {}
        self._tabs: List[Tab] = []
        self._active_tab_id: Optional[str] = None

    @property
    def active_tab_id(self) -> Optional[str]:
        return self._active_tab_id

    def list_streams(self) -> List[Stream]:
        return list(self._streams.values())

    def list_tabs(self) -> List[Tab]:
        return list(self._tabs)
