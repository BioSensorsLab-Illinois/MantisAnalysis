"""Library — durable file-backed assets (Recordings, DarkFrames).

Library is the **only** durable surface in Playback. Streams + Tabs
(in ``workspace.py``) are user-mutable artifacts built on top of the
Library; they live in process memory only.

Recording filenames may follow a structured convention:
``sample_<n>_view_<v>_exp_<seconds>.h5`` — when present, ``sample``,
``view``, and ``exposure_s`` are parsed and surfaced for grouping in the
UI. When absent, those fields are ``None`` and the file appears under
"Other recordings" in the library rail.
"""

from __future__ import annotations

import re
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

import numpy as np

from . import h5io


_FILENAME_RE = re.compile(
    r"sample_(?P<sample>\d+)_view_(?P<view>\d+)_exp_(?P<exp>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Recording:
    """One H5 file registered in the Library."""

    rec_id: str
    path: Path
    name: str
    sample: Optional[int]
    view: Optional[int]
    exposure_s: Optional[float]
    n_frames: int
    raw_shape: Tuple[int, int]
    timestamp_start_s: Optional[float]
    timestamp_end_s: Optional[float]


@dataclass(frozen=True)
class DarkFrame:
    """Master dark frame averaged from a dark-recording H5."""

    dark_id: str
    name: str
    exposure_s: float
    n_source_frames: int
    strategy: Literal["mean", "median", "sigma_clip"]
    master: np.ndarray  # 2D uint16 (H, W) matching recording raw_shape


def parse_filename(name: str) -> Tuple[Optional[int], Optional[int], Optional[float]]:
    """Pull (sample, view, exposure_s) from the structured filename."""

    m = _FILENAME_RE.search(name)
    if not m:
        return None, None, None
    return int(m["sample"]), int(m["view"]), float(m["exp"])


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class Library:
    """Process-global Recording + DarkFrame registry. Thread-safe."""

    def __init__(self) -> None:
        self._recordings: Dict[str, Recording] = {}
        self._darks: Dict[str, DarkFrame] = {}
        self._lock = threading.RLock()

    # ---- Recordings ------------------------------------------------

    def register_recording(self, path: str | Path, name: Optional[str] = None) -> Recording:
        """Inspect an H5 and add it to the Library. Returns the new Recording.

        Refuses recordings with zero frames — those would let
        ``Workspace._clamp_tabs_for_stream_locked`` set
        ``active_frame=0`` against an empty dataset, which then 422s
        every render and reproduces the v1 "Frame not decoded" bug.
        """

        p = Path(path)
        meta = h5io.inspect(p)
        if meta.n_frames < 1:
            raise ValueError(f"{p.name}: recording has zero frames")
        display_name = name or p.name
        sample, view, exposure_s = parse_filename(display_name)

        ts = meta.timestamps_s
        ts_start = float(ts[0]) if ts is not None and ts.size else None
        ts_end = float(ts[-1]) if ts is not None and ts.size else None

        rec = Recording(
            rec_id=_new_id(),
            path=p,
            name=display_name,
            sample=sample,
            view=view,
            exposure_s=exposure_s,
            n_frames=meta.n_frames,
            raw_shape=meta.raw_shape,
            timestamp_start_s=ts_start,
            timestamp_end_s=ts_end,
        )
        with self._lock:
            self._recordings[rec.rec_id] = rec
        return rec

    def get_recording(self, rec_id: str) -> Recording:
        with self._lock:
            if rec_id not in self._recordings:
                raise KeyError(rec_id)
            return self._recordings[rec_id]

    def list_recordings(self) -> List[Recording]:
        with self._lock:
            return list(self._recordings.values())

    def delete_recording(self, rec_id: str) -> None:
        """Remove a recording from the Library.

        The cascade onto Streams + Tabs is handled by Workspace.
        delete_recording — the Library only manages its own state.
        """
        with self._lock:
            if rec_id not in self._recordings:
                raise KeyError(rec_id)
            del self._recordings[rec_id]

    # ---- Darks -----------------------------------------------------

    def register_dark(self, dark: DarkFrame) -> DarkFrame:
        with self._lock:
            self._darks[dark.dark_id] = dark
        return dark

    def get_dark(self, dark_id: str) -> DarkFrame:
        with self._lock:
            if dark_id not in self._darks:
                raise KeyError(dark_id)
            return self._darks[dark_id]

    def list_darks(self) -> List[DarkFrame]:
        with self._lock:
            return list(self._darks.values())

    def delete_dark(self, dark_id: str) -> None:
        with self._lock:
            if dark_id not in self._darks:
                raise KeyError(dark_id)
            del self._darks[dark_id]
