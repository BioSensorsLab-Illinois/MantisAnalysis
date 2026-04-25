"""SSE event bus for library + workspace + job changes.

The frontend subscribes once to ``GET /api/playback/events`` and
diffs the workspace from event payloads instead of polling.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


@dataclass(frozen=True)
class Event:
    """One event on the bus."""

    type: str
    payload: Dict[str, Any]


class EventBus:
    """In-process pub/sub. M2 implements the SSE wiring."""

    def __init__(self) -> None:
        self._subscribers: list = []

    def emit(self, event: Event) -> None:
        for sub in list(self._subscribers):
            try:
                sub(event)
            except Exception:
                pass
