"""Workspace — user-mutable Streams + Tabs built on top of Library.

Cascade rules live here in one place. The bug class from playback v1
("zombie streams after delete_recording") is fixed by construction:

* ``workspace.delete_recording(rec_id)`` walks every stream that
  references ``rec_id``.
* If the stream was single-recording, it is **deleted**, and any tab
  pointing at it is **closed**.
* If multi-recording, the rec is dropped, total_frames is rebuilt,
  active frames are clamped, the tab survives.
* One ``library.recording.deleted`` event captures all of it; the
  frontend diffs on the event payload instead of guessing.

Workspace owns the Library reference because every cascade has to
mutate both atomically. Library mutations from outside Workspace are
allowed but skip the cascade — use ``Workspace.delete_recording`` for
the safe path.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

from .events import Event, EventBus
from .library import Library


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


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class Workspace:
    """Process-global workspace — one per server.

    Owns the Library; mutations that cascade across Library →
    Streams → Tabs go through Workspace methods so the cascade is
    atomic and emits exactly one event per user action.
    """

    def __init__(self, library: Optional[Library] = None,
                 events: Optional[EventBus] = None) -> None:
        self.library = library or Library()
        self.events = events or EventBus()
        self._streams: Dict[str, Stream] = {}
        self._tabs: Dict[str, Tab] = {}
        self._tab_order: List[str] = []
        self._active_tab_id: Optional[str] = None
        self._lock = threading.RLock()

    @property
    def active_tab_id(self) -> Optional[str]:
        return self._active_tab_id

    # ---- Streams ----------------------------------------------------

    def build_stream(self, rec_ids: List[str], name: Optional[str] = None,
                     fps_override: Optional[float] = None) -> Stream:
        if not rec_ids:
            raise ValueError("build_stream requires at least one recording id")
        with self._lock:
            for rid in rec_ids:
                self.library.get_recording(rid)  # KeyError if unknown
            stream_name = name or self._auto_stream_name(rec_ids)
            s = Stream(
                stream_id=_new_id(),
                name=stream_name,
                rec_ids=list(rec_ids),
                fps_override=fps_override,
            )
            self._streams[s.stream_id] = s
        return s

    def _auto_stream_name(self, rec_ids: List[str]) -> str:
        if len(rec_ids) == 1:
            r = self.library.get_recording(rec_ids[0])
            return r.name
        return f"Stream of {len(rec_ids)} recordings"

    def get_stream(self, stream_id: str) -> Stream:
        with self._lock:
            if stream_id not in self._streams:
                raise KeyError(stream_id)
            return self._streams[stream_id]

    def list_streams(self) -> List[Stream]:
        with self._lock:
            return list(self._streams.values())

    def stream_total_frames(self, stream_id: str) -> int:
        with self._lock:
            s = self._streams[stream_id]
            return sum(self.library.get_recording(rid).n_frames for rid in s.rec_ids)

    def delete_stream(self, stream_id: str) -> List[str]:
        """Remove a stream + close any tabs that point at it.

        Returns the list of closed tab ids.
        """
        with self._lock:
            if stream_id not in self._streams:
                raise KeyError(stream_id)
            del self._streams[stream_id]
            closed = self._close_tabs_for_stream_locked(stream_id)
        self.events.emit(Event(
            type="workspace.stream.deleted",
            payload={"stream_id": stream_id, "closed_tabs": closed},
        ))
        return closed

    # ---- Tabs -------------------------------------------------------

    def open_tab(self, stream_id: str, layout: Layout = "single",
                 views: Optional[List[View]] = None) -> Tab:
        with self._lock:
            self.get_stream(stream_id)  # validate
            tab = Tab(
                tab_id=_new_id(),
                stream_id=stream_id,
                layout=layout,
                views=views if views is not None else [self._default_view()],
                active_frame=0,
            )
            tab.selected_view_id = tab.views[0].view_id if tab.views else None
            self._tabs[tab.tab_id] = tab
            self._tab_order.append(tab.tab_id)
            self._active_tab_id = tab.tab_id
        self.events.emit(Event(
            type="workspace.tab.opened",
            payload={"tab_id": tab.tab_id, "stream_id": stream_id},
        ))
        return tab

    def _default_view(self) -> View:
        return View(view_id=_new_id())

    def get_tab(self, tab_id: str) -> Tab:
        with self._lock:
            if tab_id not in self._tabs:
                raise KeyError(tab_id)
            return self._tabs[tab_id]

    def list_tabs(self) -> List[Tab]:
        with self._lock:
            return [self._tabs[tid] for tid in self._tab_order if tid in self._tabs]

    def close_tab(self, tab_id: str) -> None:
        with self._lock:
            if tab_id not in self._tabs:
                raise KeyError(tab_id)
            del self._tabs[tab_id]
            self._tab_order = [t for t in self._tab_order if t != tab_id]
            if self._active_tab_id == tab_id:
                self._active_tab_id = self._tab_order[-1] if self._tab_order else None
        self.events.emit(Event(
            type="workspace.tab.closed",
            payload={"tab_id": tab_id},
        ))

    def _close_tabs_for_stream_locked(self, stream_id: str) -> List[str]:
        """Close every tab pointing at stream_id. Caller holds the lock."""
        closed: List[str] = []
        for tid in list(self._tab_order):
            if self._tabs[tid].stream_id == stream_id:
                del self._tabs[tid]
                self._tab_order = [t for t in self._tab_order if t != tid]
                closed.append(tid)
        if self._active_tab_id in closed:
            self._active_tab_id = self._tab_order[-1] if self._tab_order else None
        return closed

    # ---- Cascade entry points --------------------------------------

    def delete_recording(self, rec_id: str) -> Dict[str, List[str]]:
        """Drop the recording + cascade through streams + tabs.

        Cascade rules:
        * Single-recording streams pointing at rec_id are **deleted**;
          their tabs are **closed**.
        * Multi-recording streams have rec_id removed; tabs survive,
          their active_frame is clamped to the new total_frames - 1.

        Emits exactly one ``library.recording.deleted`` event with the
        cascade payload.
        """
        with self._lock:
            self.library.get_recording(rec_id)  # KeyError if unknown

            deleted_streams: List[str] = []
            shrunk_streams: List[str] = []
            closed_tabs: List[str] = []

            for sid in list(self._streams.keys()):
                s = self._streams[sid]
                if rec_id not in s.rec_ids:
                    continue
                if len(s.rec_ids) == 1:
                    del self._streams[sid]
                    deleted_streams.append(sid)
                    closed_tabs.extend(self._close_tabs_for_stream_locked(sid))
                else:
                    s.rec_ids = [r for r in s.rec_ids if r != rec_id]
                    shrunk_streams.append(sid)
                    self._clamp_tabs_for_stream_locked(sid)

            self.library.delete_recording(rec_id)

        self.events.emit(Event(
            type="library.recording.deleted",
            payload={
                "rec_id": rec_id,
                "deleted_streams": deleted_streams,
                "shrunk_streams": shrunk_streams,
                "closed_tabs": closed_tabs,
            },
        ))
        return {
            "deleted_streams": deleted_streams,
            "shrunk_streams": shrunk_streams,
            "closed_tabs": closed_tabs,
        }

    def _clamp_tabs_for_stream_locked(self, stream_id: str) -> None:
        """After a stream shrinks, clamp every tab's active_frame."""
        new_total = self.stream_total_frames(stream_id)
        ceiling = max(new_total - 1, 0)
        for tab in self._tabs.values():
            if tab.stream_id != stream_id:
                continue
            if tab.active_frame > ceiling:
                tab.active_frame = ceiling
            for v in tab.views:
                if v.locked_frame is not None and v.locked_frame > ceiling:
                    v.locked_frame = ceiling

    # ---- PATCH entry points (frontend mutations) ------------------

    _ALLOWED_TAB_FIELDS = frozenset({"active_frame", "layout", "selected_view_id"})
    _ALLOWED_VIEW_FIELDS = frozenset({
        "name", "type", "channel", "locked_frame", "sync_to_global",
        "export_include", "dark_on", "dark_id", "gain", "offset",
        "normalize", "low", "high", "colormap", "invert", "show_clipped",
    })

    def patch_tab(self, tab_id: str, **fields) -> Tab:
        """Apply a small set of allow-listed mutations to a Tab.

        active_frame is clamped against the current stream's
        total_frames. Holds the workspace lock so a concurrent
        cascade can't interleave.
        """
        with self._lock:
            if tab_id not in self._tabs:
                raise KeyError(tab_id)
            tab = self._tabs[tab_id]
            for k, v in fields.items():
                if k not in self._ALLOWED_TAB_FIELDS:
                    raise ValueError(f"field not allowed: {k}")
                if k == "active_frame":
                    total = self.stream_total_frames(tab.stream_id)
                    if total <= 0:
                        v = 0
                    else:
                        v = max(0, min(int(v), total - 1))
                if k == "layout":
                    if v not in {"single", "side", "stack", "2x2", "3plus1"}:
                        raise ValueError(f"unknown layout: {v}")
                setattr(tab, k, v)
            return tab

    def patch_view(self, tab_id: str, view_id: str, **fields) -> View:
        """Apply allow-listed mutations to a View. Holds the workspace lock."""
        with self._lock:
            if tab_id not in self._tabs:
                raise KeyError(f"unknown tab id: {tab_id}")
            tab = self._tabs[tab_id]
            view = next((v for v in tab.views if v.view_id == view_id), None)
            if view is None:
                raise KeyError(f"unknown view id: {view_id}")
            for k, v in fields.items():
                if k not in self._ALLOWED_VIEW_FIELDS:
                    raise ValueError(f"field not allowed: {k}")
                if k == "locked_frame" and v is not None:
                    total = self.stream_total_frames(tab.stream_id)
                    if total <= 0:
                        v = 0
                    else:
                        v = max(0, min(int(v), total - 1))
                if k in {"low", "high"} and v is not None:
                    v = max(0, min(int(v), 65535))
                if k == "gain" and v is not None:
                    v = max(0.001, min(float(v), 100.0))
                setattr(view, k, v)
            return view

    def delete_dark(self, dark_id: str) -> List[str]:
        """Drop a dark frame + clear every view that references it.

        Returns the list of view_ids cleared. Emits one
        ``library.dark.deleted`` event.
        """
        with self._lock:
            self.library.get_dark(dark_id)  # KeyError if unknown
            cleared_views: List[str] = []
            for tab in self._tabs.values():
                for v in tab.views:
                    if v.dark_id == dark_id:
                        v.dark_on = False
                        v.dark_id = None
                        cleared_views.append(v.view_id)
            self.library.delete_dark(dark_id)

        self.events.emit(Event(
            type="library.dark.deleted",
            payload={"dark_id": dark_id, "cleared_views": cleared_views},
        ))
        return cleared_views
