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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

import numpy as np


_FILENAME_RE = re.compile(
    r"sample_(?P<sample>\d+)_view_(?P<view>\d+)_exp_(?P<exp>[\d.]+)",
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
    """Pull (sample, view, exposure_s) from the structured filename.

    Returns ``(None, None, None)`` if the name doesn't match.
    """

    m = _FILENAME_RE.search(name)
    if not m:
        return None, None, None
    return int(m["sample"]), int(m["view"]), float(m["exp"])


class Library:
    """Process-global Recording + DarkFrame registry. Thread-safe."""

    def __init__(self) -> None:
        self._recordings: Dict[str, Recording] = {}
        self._darks: Dict[str, DarkFrame] = {}

    # M1 fills these in — M0 leaves stubs so import succeeds.

    def list_recordings(self) -> List[Recording]:
        return list(self._recordings.values())

    def list_darks(self) -> List[DarkFrame]:
        return list(self._darks.values())
