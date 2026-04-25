"""Image + video export for Playback (M10).

Pure NumPy / PIL / imageio-ffmpeg (optional) module — no FastAPI
imports (AGENT_RULES rule 7). Both export paths call into
``playback_pipeline.render_frame`` so WYSIWYG holds: byte-equal
parity with the preview endpoint for image; perceptual parity
(< 5/20 LSB per channel) for video, since codec re-encoding makes
strict byte equality impossible.

Per user 2026-04-24:
  * Image: PNG / TIFF / JPEG; tiled compose with 1-px divider.
  * Video: MP4 (H.264) / APNG / GIF / PNG-seq; ProcessPoolExecutor
    workers re-open H5 by path (risk-skeptic P0-A — workers never
    receive a pickled h5py object); cancel via multiprocessing.Event.
  * Sidecar JSON written next to every export — full ViewState[],
    stream metadata, render-pipeline-version, frame range, fps.
  * GIF capped at 300 frames (risk-skeptic P1-E).
"""

from __future__ import annotations

import io
import json
import multiprocessing
import multiprocessing.synchronize
import threading
import time
import uuid
import zipfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import isp_modes as _isp
from .playback_pipeline import (
    BurnInContext,
    ViewState,
    render_frame,
)
from .recording import extract_frame, RecordingMeta


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------


GIF_FRAME_CAP = 300
RENDER_PIPELINE_VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Image export
# ---------------------------------------------------------------------------


def _compose_tiled(rgbs: List[np.ndarray], cols: int, divider_color=(48, 52, 60)
                   ) -> np.ndarray:
    """Stack RGB images into an (H, W, 3) tile with a 1-px divider."""
    if not rgbs:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    rows = (len(rgbs) + cols - 1) // cols
    h = max(r.shape[0] for r in rgbs)
    w = max(r.shape[1] for r in rgbs)
    out = np.full(
        (rows * h + (rows - 1), cols * w + (cols - 1), 3),
        divider_color, dtype=np.uint8,
    )
    for i, rgb in enumerate(rgbs):
        rr = i // cols
        cc = i % cols
        y0 = rr * (h + 1)
        x0 = cc * (w + 1)
        out[y0:y0 + rgb.shape[0], x0:x0 + rgb.shape[1]] = rgb
    return out


def render_views_for_frame(views: Sequence[ViewState],
                            channels: Dict[str, np.ndarray],
                            *,
                            max_dim: int = 1024,
                            burn_ctx: Optional[BurnInContext] = None,
                            ) -> List[np.ndarray]:
    """Render every view for a single frame's channel dict."""
    return [
        render_frame(channels, v, dark=None,
                     max_dim=max_dim, burn_ctx=burn_ctx)
        for v in views
    ]


def export_image_bytes(rgbs: List[np.ndarray],
                        *,
                        compose: str = "contactSheet",
                        tile_arrangement: Optional[Tuple[int, int]] = None,
                        fmt: str = "png",
                        bit_depth: int = 8,
                        ) -> Tuple[bytes, str]:
    """Compose + encode N rendered RGB views as one image.

    Returns ``(bytes, mime_type)``. Compose:
      single        — only the first view; everything else dropped.
      contactSheet  — 1×N row.
      grid          — tile_arrangement = (cols, rows); N must fit.
    """
    from PIL import Image

    if not rgbs:
        raise ValueError("export_image: no views to export")
    if compose == "single":
        canvas = rgbs[0]
    elif compose == "contactSheet":
        canvas = _compose_tiled(rgbs, cols=len(rgbs))
    elif compose == "grid":
        cols, rows = tile_arrangement or (2, 2)
        if cols * rows < len(rgbs):
            raise ValueError(
                f"grid arrangement {cols}×{rows} too small for {len(rgbs)} views"
            )
        canvas = _compose_tiled(rgbs, cols=cols)
    else:
        raise ValueError(f"unknown compose mode: {compose!r}")

    fmt = fmt.lower()
    buf = io.BytesIO()
    if fmt == "png":
        Image.fromarray(canvas, mode="RGB").save(buf, format="PNG", optimize=False)
        return buf.getvalue(), "image/png"
    if fmt in ("tif", "tiff"):
        # 16-bit TIFF: scale uint8 → uint16 (linearly) so the file's
        # bit-depth tag reflects the request. Byte-perfect downscale
        # back to 8-bit.
        if bit_depth == 16:
            arr16 = (canvas.astype(np.uint16) * 257)
            Image.fromarray(arr16, mode="RGB").save(buf, format="TIFF",
                                                    compression=None)
        else:
            Image.fromarray(canvas, mode="RGB").save(buf, format="TIFF",
                                                     compression=None)
        return buf.getvalue(), "image/tiff"
    if fmt in ("jpg", "jpeg"):
        Image.fromarray(canvas, mode="RGB").save(buf, format="JPEG", quality=95)
        return buf.getvalue(), "image/jpeg"
    raise ValueError(f"unknown image format: {fmt!r}")


# ---------------------------------------------------------------------------
# ffmpeg gate
# ---------------------------------------------------------------------------


def has_ffmpeg() -> bool:
    """Prove ffmpeg actually runs (risk-skeptic P1-D)."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        import subprocess
        proc = subprocess.run([exe, "-version"], capture_output=True,
                              timeout=5, check=False)
        return proc.returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Video export — frame iteration + writer
# ---------------------------------------------------------------------------


def render_frame_for_export(rec_path: str,
                             frame_dataset_path: str,
                             local_frame: int,
                             isp_mode_id: str,
                             isp_config: Dict[str, Any],
                             views_payload: List[Dict[str, Any]],
                             max_dim: int,
                             ts_s: float,
                             ) -> np.ndarray:
    """Worker entry point.  Re-opens the H5 by path inside the worker
    process (risk-skeptic P0-A); never receives a pickled h5py object.
    Returns one composed RGB frame (contactSheet or single)."""
    from .recording import RecordingMeta as _Meta
    # Reconstruct a minimal RecordingMeta — only the fields extract_frame
    # needs. (Keeps cross-process payload small.)
    meta = _Meta(
        path=rec_path,
        name=Path(rec_path).name,
        size_bytes=0,
        frame_count=local_frame + 1,  # only used for bounds check
        frame_shape=(0, 0),
        raw_shape=(0, 0),
        channels=(),
        isp_mode_id=isp_mode_id,
        frame_dataset_path=frame_dataset_path,
        timestamps_available=False,
        timestamp_start_s=None,
        timestamp_end_s=None,
        estimated_fps=None,
        exposure_min=None,
        exposure_max=None,
        exposure_mean=None,
        camera_attrs={},
        warnings=(),
        errors=(),
    )
    mode = _isp.get_mode(isp_mode_id)
    cfg = _isp.normalize_config(mode, isp_config)
    channels = extract_frame(meta, local_frame, isp_mode=mode, isp_config=cfg)
    rgbs: List[np.ndarray] = []
    for vp in views_payload:
        # Reconstruct a ViewState; we only carry the fields render_frame
        # cares about, so build a fresh one and let the dataclass fill in
        # defaults for the rest.
        view = ViewState(**{
            k: v
            for k, v in vp.items()
            if k in ViewState.__dataclass_fields__
        })
        rgbs.append(render_frame(channels, view, dark=None,
                                  max_dim=max_dim,
                                  burn_ctx=BurnInContext(
                                      frame_index=local_frame,
                                      timestamp_s=ts_s,
                                      source_filename=Path(rec_path).name,
                                  )))
    return _compose_tiled(rgbs, cols=max(1, len(rgbs))) if len(rgbs) > 1 else rgbs[0]


def write_video(frames_iter, *,
                 out_path: Path,
                 fmt: str,
                 fps: int,
                 quality: str = "high") -> None:
    """Encode an iterator of (H, W, 3) uint8 frames to a video file.

    Supported fmt: ``mp4`` (H.264 via imageio + ffmpeg), ``apng``,
    ``gif`` (Pillow), ``png-seq`` (zip of PNGs). Raises RuntimeError
    when the format requires ffmpeg and it isn't available.
    """
    fmt = fmt.lower()
    if fmt == "png-seq":
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as zf:
            from PIL import Image
            for i, rgb in enumerate(frames_iter):
                buf = io.BytesIO()
                Image.fromarray(rgb, mode="RGB").save(buf, format="PNG")
                zf.writestr(f"frame_{i:06d}.png", buf.getvalue())
        return
    if fmt == "gif":
        from PIL import Image
        pil_frames = []
        for i, rgb in enumerate(frames_iter):
            if i >= GIF_FRAME_CAP:
                raise ValueError(
                    f"GIF export limited to {GIF_FRAME_CAP} frames; "
                    "reduce range or choose another format"
                )
            pil_frames.append(Image.fromarray(rgb, mode="RGB"))
        if not pil_frames:
            raise ValueError("no frames to encode")
        duration_ms = max(20, int(1000 / max(1, fps)))
        pil_frames[0].save(
            out_path, format="GIF", save_all=True,
            append_images=pil_frames[1:], loop=0, duration=duration_ms,
            optimize=True,
        )
        return
    if fmt == "apng":
        from PIL import Image
        pil_frames = [Image.fromarray(rgb, mode="RGB") for rgb in frames_iter]
        if not pil_frames:
            raise ValueError("no frames to encode")
        duration_ms = max(20, int(1000 / max(1, fps)))
        pil_frames[0].save(
            out_path, format="APNG", save_all=True,
            append_images=pil_frames[1:], duration=duration_ms,
            loop=0,
        )
        return
    if fmt in ("mp4",):
        if not has_ffmpeg():
            raise RuntimeError(
                "ffmpeg not available — install `imageio-ffmpeg` "
                "(`pip install -e '.[playback-video]'`)"
            )
        import imageio.v3 as iio
        crf_for = {"high": 18, "med": 23, "low": 28}
        crf = crf_for.get(quality, 18)
        # imageio v3 expects a sequence + writer params; we materialize
        # frames one-by-one to keep memory bounded.
        from imageio_ffmpeg import write_frames
        first = next(iter(frames_iter), None)
        if first is None:
            raise ValueError("no frames to encode")
        h, w = first.shape[:2]
        writer = write_frames(
            str(out_path),
            (w, h),
            fps=fps,
            quality=None,
            macro_block_size=1,
            output_params=["-crf", str(crf), "-pix_fmt", "yuv420p"],
        )
        writer.send(None)  # initialize
        writer.send(first.tobytes())
        for rgb in frames_iter:
            writer.send(rgb.tobytes())
        writer.close()
        return
    raise ValueError(f"unknown video fmt: {fmt!r}")


# ---------------------------------------------------------------------------
# Sidecar JSON
# ---------------------------------------------------------------------------


def write_sidecar(path: Path, *,
                   stream_payload: Dict[str, Any],
                   views: Sequence[ViewState],
                   frame_range: Tuple[int, int],
                   fps: int,
                   fmt: str,
                   compose: str,
                   build_version: str) -> Path:
    """Write a <output>.json sidecar describing the export."""
    sidecar_path = path.with_suffix(path.suffix + ".json")
    payload = {
        "render_pipeline_version": RENDER_PIPELINE_VERSION,
        "build_version": build_version,
        "format": fmt,
        "compose": compose,
        "fps": fps,
        "frame_range": list(frame_range),
        "frame_count": frame_range[1] - frame_range[0] + 1,
        "stream": stream_payload,
        "views": [asdict(v) if hasattr(v, "__dataclass_fields__") else v
                  for v in views],
        "exported_at": time.time(),
    }
    sidecar_path.write_text(json.dumps(payload, indent=2, default=str))
    return sidecar_path


__all__ = [
    "GIF_FRAME_CAP",
    "RENDER_PIPELINE_VERSION",
    "render_views_for_frame",
    "export_image_bytes",
    "render_frame_for_export",
    "write_video",
    "write_sidecar",
    "has_ffmpeg",
    "_compose_tiled",
]
