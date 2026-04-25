"""FastAPI surface for Playback. Thin — most logic is in workspace.py.

Routes (10 total):

* ``GET    /api/playback/workspace``                       — full state snapshot
* ``GET    /api/playback/events``                          — Server-Sent-Events stream
* ``POST   /api/playback/recordings`` (multipart upload OR ``{path}``)
* ``DELETE /api/playback/recordings/{rec_id}``
* ``POST   /api/playback/darks``                           — register a dark
* ``DELETE /api/playback/darks/{dark_id}``
* ``POST   /api/playback/streams``                         — build a stream from rec_ids
* ``DELETE /api/playback/streams/{stream_id}``
* ``POST   /api/playback/tabs``                            — open a tab on a stream
* ``DELETE /api/playback/tabs/{tab_id}``

Image / video export and per-frame PNG arrive in M5.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel, ConfigDict
from starlette.responses import Response, StreamingResponse

from . import render as _render
from .events import Event
from .workspace import View, Workspace


# Process-global workspace singleton. The FastAPI app keeps a single
# Workspace; the same instance is reused across requests + SSE clients.
WORKSPACE = Workspace()


# ---------------------------------------------------------------------------
# DTO serialization — mirror web/src/playback/api.ts
# ---------------------------------------------------------------------------


def _recording_dto(rec) -> Dict[str, Any]:
    return {
        "rec_id": rec.rec_id,
        "name": rec.name,
        "path": str(rec.path),
        "sample": rec.sample,
        "view": rec.view,
        "exposure_s": rec.exposure_s,
        "n_frames": rec.n_frames,
        "raw_shape": list(rec.raw_shape),
        "timestamp_start_s": rec.timestamp_start_s,
        "timestamp_end_s": rec.timestamp_end_s,
    }


def _dark_dto(d) -> Dict[str, Any]:
    return {
        "dark_id": d.dark_id,
        "name": d.name,
        "exposure_s": d.exposure_s,
        "n_source_frames": d.n_source_frames,
        "strategy": d.strategy,
    }


def _stream_dto(s, ws: Workspace) -> Dict[str, Any]:
    return {
        "stream_id": s.stream_id,
        "name": s.name,
        "rec_ids": list(s.rec_ids),
        "fps_override": s.fps_override,
        "total_frames": ws.stream_total_frames(s.stream_id),
    }


def _view_dto(v: View) -> Dict[str, Any]:
    d = asdict(v)
    return d


def _tab_dto(t) -> Dict[str, Any]:
    return {
        "tab_id": t.tab_id,
        "stream_id": t.stream_id,
        "layout": t.layout,
        "views": [_view_dto(v) for v in t.views],
        "active_frame": t.active_frame,
        "selected_view_id": t.selected_view_id,
    }


def _workspace_dto(ws: Workspace) -> Dict[str, Any]:
    return {
        "library": {
            "recordings": [_recording_dto(r) for r in ws.library.list_recordings()],
            "darks": [_dark_dto(d) for d in ws.library.list_darks()],
        },
        "streams": [_stream_dto(s, ws) for s in ws.list_streams()],
        "tabs": [_tab_dto(t) for t in ws.list_tabs()],
        "active_tab_id": ws.active_tab_id,
    }


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class RecordingFromPathRequest(BaseModel):
    path: str
    name: Optional[str] = None


class BuildStreamRequest(BaseModel):
    rec_ids: List[str]
    name: Optional[str] = None
    fps_override: Optional[float] = None


class OpenTabRequest(BaseModel):
    stream_id: str
    layout: str = "single"


class FromFolderRequest(BaseModel):
    root: str


class TabPatchRequest(BaseModel):
    """Allow-listed fields a client can PATCH on a Tab.

    ``extra='forbid'`` so an unknown field (e.g. attempting to
    rewrite ``tab_id`` or ``stream_id``) returns 422 instead of being
    silently dropped — that's the v1 PATCH-allows-anything class of bug.
    """

    model_config = ConfigDict(extra="forbid")

    active_frame: Optional[int] = None
    layout: Optional[str] = None
    selected_view_id: Optional[str] = None


class ViewPatchRequest(BaseModel):
    """Allow-listed fields a client can PATCH on a View. Identity
    fields (view_id) and channel-list (channels) are deliberately
    excluded so a client can't rewrite ids or break the channel
    invariant. ``extra='forbid'`` rejects unknown fields with 422.
    """

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    type: Optional[str] = None
    channel: Optional[str] = None
    locked_frame: Optional[int] = None
    sync_to_global: Optional[bool] = None
    export_include: Optional[bool] = None
    dark_on: Optional[bool] = None
    dark_id: Optional[str] = None
    gain: Optional[float] = None
    offset: Optional[float] = None
    normalize: Optional[bool] = None
    low: Optional[int] = None
    high: Optional[int] = None
    colormap: Optional[str] = None
    invert: Optional[bool] = None
    show_clipped: Optional[bool] = None


# ---------------------------------------------------------------------------
# SSE
# ---------------------------------------------------------------------------


def _format_sse(event: Event) -> str:
    data = json.dumps({"type": event.type, "payload": event.payload})
    return f"event: {event.type}\ndata: {data}\n\n"


async def _event_stream(ws: Workspace) -> AsyncIterator[str]:
    """Async generator yielding SSE-formatted events.

    The synchronous EventBus.subscribe callback bridges into the async
    loop via ``loop.call_soon_threadsafe(queue.put_nowait, …)``. A
    periodic keepalive comment is sent every 15 s so reverse proxies
    don't reap the connection.
    """

    loop = asyncio.get_running_loop()
    q: "asyncio.Queue[Event]" = asyncio.Queue()

    def _push(event: Event) -> None:
        loop.call_soon_threadsafe(q.put_nowait, event)

    unsubscribe = ws.events.subscribe(_push)
    try:
        yield "event: open\ndata: {}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield _format_sse(event)
    except asyncio.CancelledError:
        raise
    finally:
        unsubscribe()


# ---------------------------------------------------------------------------
# Mount
# ---------------------------------------------------------------------------


def mount(app: FastAPI, workspace: Optional[Workspace] = None) -> Workspace:
    """Register Playback routes. Returns the bound Workspace.

    If the ``MANTIS_PLAYBACK_DATASET`` env var is set to a directory
    path, every ``.h5`` / ``.hdf5`` under it is registered into the
    Library at app boot. Useful for dev / demo so the rail is
    populated without the user dragging files. Failures are
    non-fatal — bad paths just log a warning and the rail starts
    empty.
    """

    ws = workspace or WORKSPACE
    _preload = os.environ.get("MANTIS_PLAYBACK_DATASET")
    if _preload:
        try:
            p = Path(_preload).expanduser()
            if p.is_dir() and not ws.library.list_recordings():
                for f in sorted(p.iterdir()):
                    if f.is_file() and f.suffix.lower() in {".h5", ".hdf5"}:
                        try:
                            ws.library.register_recording(f)
                        except Exception:
                            pass
        except Exception:
            pass

    @app.get("/api/playback/workspace")
    def get_workspace() -> Dict[str, Any]:
        return _workspace_dto(ws)

    @app.get("/api/playback/events")
    async def stream_events():
        return StreamingResponse(
            _event_stream(ws),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    # ---- Recordings -------------------------------------------------

    @app.post("/api/playback/recordings/from-path")
    def register_recording_from_path(req: RecordingFromPathRequest) -> Dict[str, Any]:
        p = Path(req.path).expanduser()
        if not p.exists():
            raise HTTPException(404, f"path does not exist: {p}")
        try:
            rec = ws.library.register_recording(p, name=req.name)
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(422, str(e)) from e
        ws.events.emit(Event(
            type="library.recording.added",
            payload={"rec_id": rec.rec_id},
        ))
        return _recording_dto(rec)

    @app.post("/api/playback/recordings/upload")
    async def upload_recording(file: UploadFile = File(...)) -> Dict[str, Any]:
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty upload")
        out_dir = Path("outputs/playback/uploads")
        out_dir.mkdir(parents=True, exist_ok=True)
        target = out_dir / (file.filename or "upload.h5")
        target.write_bytes(data)
        try:
            rec = ws.library.register_recording(target, name=file.filename)
        except (FileNotFoundError, ValueError) as e:
            try:
                target.unlink()
            except OSError:
                pass
            raise HTTPException(422, str(e)) from e
        ws.events.emit(Event(
            type="library.recording.added",
            payload={"rec_id": rec.rec_id},
        ))
        return _recording_dto(rec)

    @app.post("/api/playback/recordings/from-folder")
    async def register_recordings_from_folder(req: FromFolderRequest) -> Dict[str, Any]:
        """Bulk-register every .h5 / .hdf5 under ``root`` in one call.

        Convenience for the lab workstation. Refuses if the path
        doesn't exist or isn't a directory. Returns
        ``{added: [recDTO], errors: [{path, error}]}``.
        """
        p = Path(req.root).expanduser()
        if not p.exists() or not p.is_dir():
            raise HTTPException(404, f"not a directory: {p}")
        files = sorted(
            q for q in p.iterdir()
            if q.is_file() and q.suffix.lower() in {".h5", ".hdf5"}
        )
        added: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        loop = asyncio.get_running_loop()
        for f in files:
            # Run blocking h5py I/O in the default executor so the SSE
            # event loop stays responsive between files.
            try:
                rec = await loop.run_in_executor(None, ws.library.register_recording, f)
            except (FileNotFoundError, ValueError) as e:
                errors.append({"path": str(f), "error": str(e)})
                continue
            ws.events.emit(Event(
                type="library.recording.added",
                payload={"rec_id": rec.rec_id},
            ))
            added.append(_recording_dto(rec))
        return {"added": added, "errors": errors}

    @app.delete("/api/playback/recordings/{rec_id}")
    def delete_recording(rec_id: str) -> Dict[str, Any]:
        try:
            cascade = ws.delete_recording(rec_id)
        except KeyError:
            raise HTTPException(404, f"unknown recording id: {rec_id}")
        return {"ok": True, **cascade}

    # ---- Darks ------------------------------------------------------

    @app.delete("/api/playback/darks/{dark_id}")
    def delete_dark(dark_id: str) -> Dict[str, Any]:
        try:
            cleared = ws.delete_dark(dark_id)
        except KeyError:
            raise HTTPException(404, f"unknown dark id: {dark_id}")
        return {"ok": True, "cleared_views": cleared}

    # ---- Streams ----------------------------------------------------

    @app.post("/api/playback/streams")
    def build_stream(req: BuildStreamRequest) -> Dict[str, Any]:
        try:
            s = ws.build_stream(
                req.rec_ids, name=req.name, fps_override=req.fps_override
            )
        except KeyError as e:
            raise HTTPException(404, f"unknown recording id: {e}")
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        ws.events.emit(Event(
            type="workspace.stream.built",
            payload={"stream_id": s.stream_id, "rec_ids": list(s.rec_ids)},
        ))
        return _stream_dto(s, ws)

    @app.delete("/api/playback/streams/{stream_id}")
    def delete_stream(stream_id: str) -> Dict[str, Any]:
        try:
            closed = ws.delete_stream(stream_id)
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        return {"ok": True, "closed_tabs": closed}

    # ---- Tabs -------------------------------------------------------

    @app.post("/api/playback/tabs")
    def open_tab(req: OpenTabRequest) -> Dict[str, Any]:
        try:
            tab = ws.open_tab(req.stream_id, layout=req.layout)  # type: ignore[arg-type]
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {req.stream_id}")
        return _tab_dto(tab)

    @app.delete("/api/playback/tabs/{tab_id}")
    def close_tab(tab_id: str) -> Dict[str, Any]:
        try:
            ws.close_tab(tab_id)
        except KeyError:
            raise HTTPException(404, f"unknown tab id: {tab_id}")
        return {"ok": True}

    @app.patch("/api/playback/tabs/{tab_id}")
    async def update_tab(tab_id: str, req: TabPatchRequest) -> Dict[str, Any]:
        """Patch tab state. Mutations go through Workspace.patch_tab so
        the cascade lock is held + active_frame is clamped to the
        current stream length.
        """
        try:
            patch = req.model_dump(exclude_unset=True)
            tab = ws.patch_tab(tab_id, **patch)
        except KeyError:
            raise HTTPException(404, f"unknown tab id: {tab_id}")
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return _tab_dto(tab)

    @app.patch("/api/playback/tabs/{tab_id}/views/{view_id}")
    async def update_view(
        tab_id: str, view_id: str, req: ViewPatchRequest
    ) -> Dict[str, Any]:
        """Patch fields on one view inside a tab. Goes through
        Workspace.patch_view so the cascade lock is held and only
        allow-listed fields can be mutated.
        """
        try:
            patch = req.model_dump(exclude_unset=True)
            view = ws.patch_view(tab_id, view_id, **patch)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return _view_dto(view)

    @app.get("/api/playback/tabs/{tab_id}/export")
    async def tab_export(
        tab_id: str,
        view_id: Optional[str] = None,
        format: str = "png",
    ) -> Response:
        """Export the active frame of one view as PNG or TIFF.

        WYSIWYG: same render path as the preview frame.png. TIFF is
        produced by re-encoding the rendered RGB array via PIL.
        """
        try:
            tab = ws.get_tab(tab_id)
            stream = ws.get_stream(tab.stream_id)
        except KeyError as e:
            raise HTTPException(404, str(e))
        if view_id:
            view = next((v for v in tab.views if v.view_id == view_id), None)
        else:
            view = tab.views[0] if tab.views else None
        if view is None:
            raise HTTPException(404, "no view")
        local_frame = (
            view.locked_frame if view.locked_frame is not None else tab.active_frame
        )
        loop = asyncio.get_running_loop()
        try:
            if format.lower() == "tiff":
                bytes_ = await loop.run_in_executor(
                    None,
                    _render.render_view_tiff,
                    stream,
                    local_frame,
                    view,
                    ws.library,
                )
                media = "image/tiff"
            else:
                bytes_ = await loop.run_in_executor(
                    None,
                    _render.render_view,
                    stream,
                    local_frame,
                    view,
                    ws.library,
                )
                media = "image/png"
        except FileNotFoundError as e:
            # Underlying H5 file vanished (deleted under us).
            raise HTTPException(410, f"render failed: {e}") from e
        except (IndexError, ValueError, KeyError, OSError) as e:
            # Includes h5py.HDF5Error subclasses (which inherit OSError)
            # and IndexError for out-of-range frames after a cascade.
            raise HTTPException(422, f"render failed: {e}") from e
        safe = view.name.replace(" ", "_")
        return Response(
            content=bytes_,
            media_type=media,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{safe}_f{local_frame:05d}.{format.lower()}"'
                ),
            },
        )

    @app.get("/api/playback/tabs/{tab_id}/frame.png")
    async def tab_frame_png(tab_id: str, view_id: Optional[str] = None) -> Response:
        """Render the active frame for one view as PNG bytes."""
        try:
            tab = ws.get_tab(tab_id)
            stream = ws.get_stream(tab.stream_id)
        except KeyError as e:
            raise HTTPException(404, str(e))
        if view_id:
            view = next((v for v in tab.views if v.view_id == view_id), None)
        else:
            view = tab.views[0] if tab.views else None
        if view is None:
            raise HTTPException(404, "no view")
        local_frame = (
            view.locked_frame if view.locked_frame is not None else tab.active_frame
        )
        loop = asyncio.get_running_loop()
        try:
            png = await loop.run_in_executor(
                None, _render.render_view, stream, local_frame, view, ws.library
            )
        except FileNotFoundError as e:
            raise HTTPException(410, f"render failed: {e}") from e
        except (IndexError, ValueError, KeyError, OSError) as e:
            raise HTTPException(422, f"render failed: {e}") from e
        return Response(
            content=png,
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=10"},
        )

    return ws
