"""Burn-in label rendering for Play-mode export and live preview.

play-tab-recording-inspection-rescue-v1 M21.

Renders user-selected metadata (timestamp, frame index, channel, source
filename, scale bar, processing badges) onto an (H, W, 3) uint8 RGB
image using the bundled JetBrains Mono font. Pure NumPy/Pillow — no
FastAPI / React / Qt imports — so the analysis modules can call it
freely.

Public surface:
    render_labels(image_rgb, labels_config) -> ndarray

`labels_config` is a plain dict with optional fields::

    {
      "timestamp":   bool          # show "ts: <seconds>" line
      "ts_value":    float | None  # seconds; defaults to None
      "frame":       bool          # show "frame <idx>"
      "frame_index": int | None
      "channel":     bool          # show "ch <name>"
      "channel_name": str | None
      "source_file": bool          # show source filename
      "source_name": str | None
      "scale_bar":   bool          # draw a 100-px reference bar
      "processing_badges": list[str] | None  # e.g. ["DARK", "OVL"]
      "position":    "top-left" | "top-right" | "bottom-left" | "bottom-right"
      "font_size":   int           # default 12
    }

Returns the same `image_rgb` shape, dtype uint8, with the labels burned
in. No-op when every text-emitting field is False / empty.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Bundled font
# ---------------------------------------------------------------------------

_FONT_PATH = Path(__file__).resolve().parent / "static" / "fonts" / "JetBrainsMono-Regular.ttf"

# Cache loaded ImageFont instances by size — Pillow re-parses the .ttf
# on every load otherwise, and a per-frame export at 30 FPS would do
# that ~1800 times/min.
_FONT_CACHE: Dict[int, ImageFont.FreeTypeFont] = {}


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    if _FONT_PATH.exists():
        font = ImageFont.truetype(str(_FONT_PATH), size=size)
    else:
        # Bundled font missing (unusual — would mean the wheel was
        # stripped of static data). Fall back to PIL's default bitmap
        # so the burn-in path doesn't crash.
        font = ImageFont.load_default()
    _FONT_CACHE[size] = font
    return font


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_timestamp(ts: Optional[float]) -> str:
    if ts is None:
        return "ts —"
    # Always include 2 decimals so the live label width stays stable
    # across frames (avoids text jitter in playback).
    return f"ts {float(ts):.2f} s"


def _build_lines(cfg: Dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if cfg.get("frame") and cfg.get("frame_index") is not None:
        lines.append(f"frame {int(cfg['frame_index'])}")
    if cfg.get("timestamp"):
        lines.append(_format_timestamp(cfg.get("ts_value")))
    if cfg.get("channel") and cfg.get("channel_name"):
        lines.append(f"ch {cfg['channel_name']}")
    if cfg.get("source_file") and cfg.get("source_name"):
        # Trim long names — keep tail (the meaningful part for
        # GSense recordings).
        name = str(cfg["source_name"])
        if len(name) > 36:
            name = "…" + name[-35:]
        lines.append(f"src {name}")
    badges = cfg.get("processing_badges")
    if badges:
        lines.append(" ".join(str(b) for b in badges))
    return lines


def _anchor_xy(position: str, w: int, h: int, block_w: int, block_h: int,
               margin: int = 8) -> tuple[int, int]:
    pos = (position or "bottom-left").lower()
    if pos == "top-left":
        return (margin, margin)
    if pos == "top-right":
        return (w - block_w - margin, margin)
    if pos == "bottom-right":
        return (w - block_w - margin, h - block_h - margin)
    # Default: bottom-left.
    return (margin, h - block_h - margin)


# ---------------------------------------------------------------------------
# Scale bar
# ---------------------------------------------------------------------------

def _draw_scale_bar(draw: ImageDraw.ImageDraw, w: int, h: int, position: str,
                    *, margin: int = 12, length_px: int = 100,
                    thickness: int = 3, font: Optional[ImageFont.FreeTypeFont] = None,
                    label: Optional[str] = None) -> None:
    """Draw a horizontal scale bar with an optional label.

    `length_px` is the bar length in screen pixels (after any backend
    resize); calibration to physical units is the caller's job.
    """
    pos = (position or "bottom-left").lower()
    # Anchor in the corner opposite the text block so they don't overlap;
    # if the user puts text in bottom-left, the bar goes bottom-right.
    bar_pos = {
        "top-left": "top-right",
        "top-right": "top-left",
        "bottom-left": "bottom-right",
        "bottom-right": "bottom-left",
    }.get(pos, "bottom-right")
    if bar_pos == "top-left":
        x0, y0 = margin, margin
    elif bar_pos == "top-right":
        x0, y0 = w - margin - length_px, margin
    elif bar_pos == "bottom-left":
        x0, y0 = margin, h - margin - thickness
    else:  # bottom-right
        x0, y0 = w - margin - length_px, h - margin - thickness
    x1, y1 = x0 + length_px, y0 + thickness
    # White bar with a 1-px black halo so it reads against light + dark
    # backgrounds.
    draw.rectangle((x0 - 1, y0 - 1, x1 + 1, y1 + 1), fill=(0, 0, 0))
    draw.rectangle((x0, y0, x1, y1), fill=(255, 255, 255))
    if label and font is not None:
        # Center the label below (or above for top positions) the bar.
        try:
            tw = int(draw.textlength(label, font=font))
        except Exception:
            tw = 6 * len(label)
        tx = x0 + (length_px - tw) // 2
        ty = y0 + thickness + 2 if "top" in bar_pos else y0 - 14
        draw.text((tx + 1, ty + 1), label, fill=(0, 0, 0), font=font)
        draw.text((tx, ty), label, fill=(255, 255, 255), font=font)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def render_labels(image_rgb: np.ndarray,
                  labels_config: Optional[Dict[str, Any]]) -> np.ndarray:
    """Burn the configured labels onto ``image_rgb`` (returns a new array).

    No-op (returns input unchanged) when ``labels_config`` is None / empty
    or every text-emitting field is False. Always preserves the input's
    shape and dtype (uint8). Handles 1×1 inputs without crashing.
    """
    if image_rgb is None or labels_config is None:
        return image_rgb
    if not isinstance(image_rgb, np.ndarray):
        return image_rgb
    if image_rgb.ndim != 3 or image_rgb.shape[2] not in (3, 4):
        # Not an RGB image — caller should have converted first.
        return image_rgb

    cfg = labels_config
    lines = _build_lines(cfg)
    want_scale = bool(cfg.get("scale_bar"))
    if not lines and not want_scale:
        return image_rgb

    h, w = image_rgb.shape[:2]
    if h <= 0 or w <= 0:
        return image_rgb

    # Drop alpha for the burn-in pass (Pillow text on RGBA has subtle
    # gotchas with transparent backgrounds; we re-attach alpha at end).
    src_rgb = image_rgb[..., :3]
    has_alpha = image_rgb.shape[2] == 4
    im = Image.fromarray(np.ascontiguousarray(src_rgb), mode="RGB")
    draw = ImageDraw.Draw(im, mode="RGB")

    font_size = int(cfg.get("font_size") or 12)
    # Clamp the font so a 1×1 fixture-test image stays renderable.
    font_size = max(6, min(font_size, max(8, h // 2 if h < 60 else font_size)))
    font = _load_font(font_size)

    if lines:
        # Measure the text block.
        line_h = font_size + 2
        block_h = max(line_h, line_h * len(lines))
        try:
            block_w = int(max(draw.textlength(s, font=font) for s in lines))
        except Exception:
            block_w = 6 * max(len(s) for s in lines)
        block_w += 8  # padding on the right
        block_w = min(block_w, max(0, w - 4))

        x, y = _anchor_xy(cfg.get("position", "bottom-left"),
                          w, h, block_w + 8, block_h + 4)

        # Translucent dark backdrop so text reads against any frame.
        bg = Image.new("RGBA", (block_w + 8, block_h + 4), (0, 0, 0, 178))
        im.paste(bg, (x - 4, y - 2), bg)

        for i, s in enumerate(lines):
            yy = y + i * line_h
            # 1-px halo for extra contrast.
            draw.text((x + 1, yy + 1), s, fill=(0, 0, 0), font=font)
            draw.text((x, yy), s, fill=(255, 255, 255), font=font)

    if want_scale:
        scale_label = cfg.get("scale_bar_label")
        _draw_scale_bar(draw, w, h, cfg.get("position", "bottom-left"),
                        font=font, label=scale_label,
                        length_px=int(cfg.get("scale_bar_length_px") or 100))

    out = np.asarray(im, dtype=np.uint8)
    if has_alpha:
        # Reattach the original alpha channel byte-for-byte.
        rgba = np.empty_like(image_rgb)
        rgba[..., :3] = out
        rgba[..., 3] = image_rgb[..., 3]
        return rgba
    return out
