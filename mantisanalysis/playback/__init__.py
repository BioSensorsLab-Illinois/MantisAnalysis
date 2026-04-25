"""Playback (Recording Inspection) — rebuild v2.

Pure NumPy / h5py / PIL / matplotlib analysis math; no FastAPI / React
imports here (per AGENT_RULES rule 7). FastAPI surface lives at
``api.py`` and is the only module that touches HTTP.
"""

from .library import Library, Recording, DarkFrame
from .workspace import Workspace, Stream, Tab, View
from .events import EventBus, Event

__all__ = [
    "Library",
    "Recording",
    "DarkFrame",
    "Workspace",
    "Stream",
    "Tab",
    "View",
    "EventBus",
    "Event",
]
