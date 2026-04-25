"""Unified image loader: GSense raw H5 + standard 2-D image files (PNG/TIFF/JPG).

ISP-mode aware as of isp-modes-v1. The legacy no-args ``load_any(path)``
call path produces byte-identical output (``HG/LG × {R,G,B,NIR,Y}`` for
H5, ``R/G/B/Y`` for RGB images, ``L`` for grayscale). Callers that want
to override can pass ``isp_mode_id`` + ``isp_config`` to dispatch through
``isp_modes.extract_by_spec``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import isp_modes as _isp
from .extract import (
    extract_rgb_nir,
    load_recording,
    split_dual_gain,
)

H5_EXTS = {".h5", ".hdf5"}
IMAGE_EXTS = {".png", ".tif", ".tiff", ".jpg", ".jpeg", ".bmp"}


def looks_like_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTS


def is_h5_recording(path: Path) -> bool:
    """H5 detection by magic-bytes (recordings often have no extension)."""
    if path.suffix.lower() in H5_EXTS:
        return True
    try:
        with open(path, "rb") as f:
            return f.read(8) == b"\x89HDF\r\n\x1a\n"
    except OSError:
        return False


def luminance_from_rgb(rgb: dict[str, np.ndarray]) -> np.ndarray:
    """Rec.601 luminance Y = 0.299·R + 0.587·G + 0.114·B (in source dtype)."""
    r = rgb["R"].astype(np.float64)
    g = rgb["G"].astype(np.float64)
    b = rgb["B"].astype(np.float64)
    y = 0.299 * r + 0.587 * g + 0.114 * b
    out_dtype = rgb["R"].dtype
    if np.issubdtype(out_dtype, np.integer):
        info = np.iinfo(out_dtype)
        y = np.clip(y, info.min, info.max)
    return y.astype(out_dtype, copy=False)


def load_h5_channels(
    path: Path, frame_index: int = 0
) -> tuple[dict[str, np.ndarray], dict[str, str]]:
    """Return ({"HG-R", "HG-G", ..., "LG-NIR", "HG-Y", "LG-Y"}, attrs)."""
    rec = load_recording(path, frame_slice=slice(frame_index, frame_index + 1))
    frame = rec.frames[0]
    hg_half, lg_half = split_dual_gain(frame)
    hg_ch = extract_rgb_nir(hg_half)
    lg_ch = extract_rgb_nir(lg_half)
    out: dict[str, np.ndarray] = {}
    for k, v in hg_ch.items():
        out[f"HG-{k}"] = v
    for k, v in lg_ch.items():
        out[f"LG-{k}"] = v
    out["HG-Y"] = luminance_from_rgb(hg_ch)
    out["LG-Y"] = luminance_from_rgb(lg_ch)
    return out, dict(rec.attrs)


def load_image_channels(path: Path) -> tuple[dict[str, np.ndarray], dict[str, str]]:
    """Load PNG/TIFF/JPG and return per-channel dict."""
    suf = path.suffix.lower()
    arr: np.ndarray
    if suf in (".tif", ".tiff"):
        import tifffile

        arr = np.asarray(tifffile.imread(str(path)))
    else:
        from PIL import Image

        with Image.open(path) as im:
            arr = np.asarray(im)
    attrs = {"source": str(path), "shape": str(arr.shape)}
    if arr.ndim == 2:
        # Grayscale source. If the caller didn't pin a mode, use
        # grayscale_image; mode-level extraction is a trivial identity.
        mode = _isp.get_mode(isp_mode_id or _isp.GRAYSCALE_IMAGE.id)
        cfg = _isp.normalize_config(mode, isp_config)
        channels = extract_with_mode(arr, mode, cfg)
        return channels, attrs, arr, mode.id, cfg
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        if arr.shape[-1] == 4:
            arr = arr[..., :3]
        # RGB image default — each primary lives in a separate plane,
        # so the ISP-mode machinery's extract-by-stride pattern doesn't
        # quite fit. Keep the legacy plane-split for the default path
        # to preserve byte-identical outputs, but still declare the mode
        # so downstream state has a valid handle.
        mode = _isp.get_mode(isp_mode_id or _isp.RGB_IMAGE.id)
        cfg = _isp.normalize_config(mode, isp_config)
        if mode.id == _isp.RGB_IMAGE.id:
            channels = {"R": arr[..., 0], "G": arr[..., 1], "B": arr[..., 2]}
            channels["Y"] = luminance_from_rgb(channels)
            return channels, attrs, arr, mode.id, cfg
        # Exotic override: run the generic mode path on the flattened
        # red plane. Unsupported combinations (3-D image through a Bayer
        # mode) will produce surprising output; that's the caller's call.
        channels = extract_with_mode(arr[..., 0], mode, cfg)
        return channels, attrs, arr, mode.id, cfg
    raise ValueError(f"unsupported image shape: {arr.shape}")


def load_any(path: str | Path) -> tuple[dict[str, np.ndarray], dict[str, str], str]:
    """Returns (channel_dict, attrs, source_kind in {"h5", "image"})."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    if looks_like_image(p):
        channels, attrs, raw, mode_id, cfg = load_image_channels(
            p, isp_mode_id=isp_mode_id, isp_config=isp_config,
        )
        return channels, attrs, raw, mode_id, cfg, "image"
    if is_h5_recording(p):
        channels, attrs, raw, mode_id, cfg = load_h5_channels(
            p, frame_index=0, isp_mode_id=isp_mode_id, isp_config=isp_config,
        )
        return channels, attrs, raw, mode_id, cfg, "h5"
    raise ValueError(f"unrecognized file type: {p}")
