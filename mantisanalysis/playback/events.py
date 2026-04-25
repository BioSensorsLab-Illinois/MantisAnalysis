"""SSE event bus for library + workspace + job changes.

The frontend subscribes once to ``GET /api/playback/events`` and
diffs the workspace from event payloads instead of polling.

In-process pub/sub is intentionally simple: each subscriber is a
callable; ``emit`` invokes them synchronously under the caller's
thread. The SSE wiring in api.py wraps a queue around this so the
HTTP handler can stream events to a long-poll connection.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, List


Subscriber = Callable[["Event"], None]


@dataclass(frozen=True)
class Event:
    """One event on the bus."""

    type: str
    payload: Dict[str, Any]


class EventBus:
    """In-process pub/sub. Thread-safe."""

    def __init__(self) -> None:
        self._subscribers: List[Subscriber] = []
        self._history: List[Event] = []
        self._history_cap = 256
        self._lock = threading.Lock()

    def subscribe(self, callback: Subscriber) -> Callable[[], None]:
        """Register a callback. Returns an unsubscribe function."""
        with self._lock:
            self._subscribers.append(callback)

        def _unsubscribe() -> None:
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return _unsubscribe

    def emit(self, event: Event) -> None:
        """Notify every subscriber. Errors in one subscriber don't block others."""
        with self._lock:
            self._history.append(event)
            if len(self._history) > self._history_cap:
                self._history = self._history[-self._history_cap :]
            subs = list(self._subscribers)
        for sub in subs:
            try:
                sub(event)
            except Exception:
                pass

    def history(self, since_index: int = 0) -> List[Event]:
        with self._lock:
            return list(self._history[since_index:])
