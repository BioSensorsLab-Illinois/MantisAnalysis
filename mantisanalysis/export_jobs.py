"""Background job store for long-running Play exports.

Pre-existing ``/api/sources/{sid}/export/video`` is a synchronous
one-shot — the request hangs until the full MP4 is encoded, the client
sees no progress, and the route only addresses a single source. This
module replaces that for the multi-source job-based path.

A job is created by ``POST /api/play/exports``, runs on a single
background worker thread (exports are CPU-bound and the user is one
human), and writes its MP4 to a tempfile that the user fetches via
``GET /api/play/exports/{id}/result``. Progress is sampled by
``GET /api/play/exports/{id}`` polled every ~500 ms by the frontend
modal. Cancellation flips a thread-safe ``Event`` the runner checks
between frames.

The store keeps finished jobs around for one hour so the result
download stays available across a quick browser refresh; older jobs
get reaped on the next cleanup pass to bound disk + memory.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# How long after a job finishes (done / error / cancelled) we keep its
# tempfile + record around so the client can still fetch the result.
JOB_TTL_SECONDS = 60 * 60  # 1 hour


@dataclass
class ExportJob:
    """One in-flight or completed export."""

    job_id: str
    kind: str  # "video_multi"
    # "queued" | "running" | "done" | "error" | "cancelled"
    status: str = "queued"
    progress: float = 0.0  # 0.0–1.0
    current_frame: int = 0
    total_frames: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    # Set by the runner when status = "done". The route handler reads
    # the bytes off disk and unlinks after streaming.
    result_path: Path | None = None
    result_filename: str | None = None
    result_media_type: str | None = None
    # Cancellation flag — runner checks between frames. Once tripped
    # the runner sets status = "cancelled" and bails.
    cancel_event: threading.Event = field(default_factory=threading.Event)
    # Free-form payload describing the export request, included in
    # progress responses so the client can render a sane title.
    label: str | None = None

    # Public-state snapshot for /api/play/exports/{id}.
    def public(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "kind": self.kind,
            "status": self.status,
            "progress": float(self.progress),
            "current_frame": int(self.current_frame),
            "total_frames": int(self.total_frames),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "label": self.label,
            # Don't leak the on-disk path; clients fetch via the
            # /result subroute which validates the job_id.
            "has_result": self.result_path is not None and self.result_path.exists(),
            "result_filename": self.result_filename,
        }


class JobStore:
    """Thread-safe in-memory registry of ``ExportJob`` instances.

    Single-worker executor on purpose: scientific exports happily peg
    one CPU core via ffmpeg + numpy and the user is invariably one
    person clicking Export and waiting. Adding parallelism would
    multiply peak memory without changing the user's wait time.
    """

    def __init__(self) -> None:
        self._jobs: dict[str, ExportJob] = {}
        self._futures: dict[str, Future] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="export-job")

    def create(
        self,
        *,
        kind: str,
        runner: Callable[[ExportJob], None],
        label: str | None = None,
        total_frames: int = 0,
    ) -> ExportJob:
        """Create + queue a job. The runner callable must update
        ``job.progress`` / ``job.current_frame`` / ``job.status`` and
        ``job.result_path`` itself.
        """
        job_id = uuid.uuid4().hex[:12]
        job = ExportJob(
            job_id=job_id,
            kind=kind,
            label=label,
            total_frames=int(total_frames),
        )
        with self._lock:
            self._jobs[job_id] = job
            future = self._executor.submit(self._run, job, runner)
            self._futures[job_id] = future
        return job

    def _run(self, job: ExportJob, runner: Callable[[ExportJob], None]) -> None:
        try:
            job.status = "running"
            runner(job)
            # Runner is expected to set status = done|cancelled and
            # finished_at. Fall through if it didn't (defensive default).
            if job.status == "running":
                job.status = "done"
                job.progress = 1.0
                job.finished_at = time.time()
        except Exception as exc:  # noqa: BLE001 — runner can raise anything
            import traceback

            traceback.print_exc()
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()

    def get(self, job_id: str) -> ExportJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        """Signal cancellation. The runner checks the flag between
        frames and bails; status flips to ``cancelled`` from inside the
        runner. Returns True if the job existed and wasn't already
        finished.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            if job.status in ("done", "error", "cancelled"):
                return False
            job.cancel_event.set()
            return True

    def cleanup(self) -> int:
        """Reap finished jobs older than ``JOB_TTL_SECONDS``. Returns
        the number of jobs removed. Called opportunistically from the
        polling endpoint — no separate timer thread.
        """
        now = time.time()
        removed = 0
        with self._lock:
            stale = [
                jid
                for jid, job in self._jobs.items()
                if job.finished_at is not None and (now - job.finished_at) > JOB_TTL_SECONDS
            ]
            for jid in stale:
                job = self._jobs.pop(jid, None)
                self._futures.pop(jid, None)
                if job and job.result_path and job.result_path.exists():
                    try:
                        job.result_path.unlink()
                    except OSError:
                        pass
                removed += 1
        return removed

    def shutdown(self) -> None:
        """Stop the executor on application teardown."""
        self._executor.shutdown(wait=False, cancel_futures=True)


# Module-level singleton. Imported by server.py and exposed via
# ``/api/play/exports`` routes.
JOBS = JobStore()
