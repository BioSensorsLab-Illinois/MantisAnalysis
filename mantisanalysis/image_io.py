"""Unified image loader: GSense raw H5 + standard 2-D image files (PNG/TIFF/JPG)."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Tuple

import numpy as np

from .extract import (
    LOC,
    ORIGIN,
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


def luminance_from_rgb(rgb: Dict[str, np.ndarray]) -> np.ndarray:
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


def load_h5_channels(path: Path, frame_index: int = 0
                     ) -> Tuple[Dict[str, np.ndarray], Dict[str, str]]:
    """Return ({"HG-R", "HG-G", ..., "LG-NIR", "HG-Y", "LG-Y"}, attrs)."""
    rec = load_recording(path, frame_slice=slice(frame_index, frame_index + 1))
    frame = rec.frames[0]
    hg_half, lg_half = split_dual_gain(frame)
    hg_ch = extract_rgb_nir(hg_half)
    lg_ch = extract_rgb_nir(lg_half)
    out: Dict[str, np.ndarray] = {}
    for k, v in hg_ch.items():
        out[f"HG-{k}"] = v
    for k, v in lg_ch.items():
        out[f"LG-{k}"] = v
    out["HG-Y"] = luminance_from_rgb(hg_ch)
    out["LG-Y"] = luminance_from_rgb(lg_ch)
    return out, dict(rec.attrs)


def load_image_channels(path: Path
                        ) -> Tuple[Dict[str, np.ndarray], Dict[str, str]]:
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
    if arr.ndim == 2:
        return {"L": arr}, {"source": str(path), "shape": str(arr.shape)}
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        # Drop alpha if present
        if arr.shape[-1] == 4:
            arr = arr[..., :3]
        rgb = {"R": arr[..., 0], "G": arr[..., 1], "B": arr[..., 2]}
        rgb["Y"] = luminance_from_rgb(rgb)
        return rgb, {"source": str(path), "shape": str(arr.shape)}
    raise ValueError(f"unsupported image shape: {arr.shape}")


def load_any(path: str | Path
             ) -> Tuple[Dict[str, np.ndarray], Dict[str, str], str]:
    """Returns (channel_dict, attrs, source_kind in {"h5", "image"})."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    if looks_like_image(p):
        ch, attrs = load_image_channels(p)
        return ch, attrs, "image"
    if is_h5_recording(p):
        ch, attrs = load_h5_channels(p, frame_index=0)
        return ch, attrs, "h5"
    raise ValueError(f"unrecognized file type: {p}")
