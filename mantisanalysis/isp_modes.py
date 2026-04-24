"""ISP-mode registry for channel extraction.

Each ISP mode declares a channel layout (slot ids, default names,
intra-super-pixel locs) plus the default super-pixel geometry
(``origin``, ``sub_step``, ``outer_stride``). Extraction math is a
single formula parameterized by those three 2-tuples, applied via
``extract.extract_by_spec``::

    row = loc[0] * sub_step[0] + origin[0]
    col = loc[1] * sub_step[1] + origin[1]
    return half[row::outer_stride[0], col::outer_stride[1]]

Dual-gain modes wrap every channel in ``HG-<name>`` / ``LG-<name>``
when keys are emitted; single-gain modes skip the prefix.

The registry is read-only; mirror-but-do-not-import MantisCamUnified's
``pipeline_registry.py``. We only cover the ISP variants the analysis
tool cares about (v1: bare + rgb-nir + polarization). F13 Foveon,
GSense masks, and alignment pipelines are deferred.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChannelSpec:
    """One channel slot inside an ISP mode."""
    slot_id: str              # stable key ("r", "g", "b", "nir", "i0", "raw", "l")
    default_name: str         # user-facing display name ("R", "G", "B", "NIR", ...)
    loc: Tuple[int, int]      # (loc_r, loc_c) — sub-tile position
    renameable: bool = False  # only ``rgb_nir`` 4th slot is renameable in v1
    color_hint: str = "#888"  # propagated into plotting.CHANNEL_COLORS


@dataclass(frozen=True)
class ISPMode:
    """A named sensor layout the UI can switch between."""
    id: str
    display_name: str
    description: str
    dual_gain: bool
    channels: Tuple[ChannelSpec, ...]
    default_origin: Tuple[int, int]
    default_sub_step: Tuple[int, int]
    default_outer_stride: Tuple[int, int]
    supports_rgb_composite: bool = False

    def slot_default_names(self) -> Tuple[str, ...]:
        return tuple(c.default_name for c in self.channels)

    def slot_ids(self) -> Tuple[str, ...]:
        return tuple(c.slot_id for c in self.channels)

    def get_slot(self, slot_id: str) -> Optional[ChannelSpec]:
        for c in self.channels:
            if c.slot_id == slot_id:
                return c
        return None


# ---------------------------------------------------------------------------
# Channel colors shared across modes — single source of truth that
# ``plotting.CHANNEL_COLORS`` copies from, so the UI and matplotlib
# renders agree byte-for-byte.
# ---------------------------------------------------------------------------

# RGB-NIR palette (matches the legacy CHANNEL_COLORS values at
# plotting.py:14-21 so existing plots don't shift colour).
_C_R = "#d62728"
_C_G = "#2ca02c"
_C_B = "#1f77b4"
_C_NIR = "#7f7f7f"
_C_Y = "#000000"
_C_L = "#000000"
_C_RAW = "#444444"
# Polarization (HSV quadrants — matches cv2 HSV colormap breakpoints so
# the analysis legend and the camera-side AoP map line up visually).
_C_I0 = "#d62728"    # red
_C_I45 = "#e0a400"   # amber
_C_I90 = "#2ca02c"   # green
_C_I135 = "#4a6fd6"  # blue


# ---------------------------------------------------------------------------
# Mode definitions — v1 set
# ---------------------------------------------------------------------------

BARE_SINGLE = ISPMode(
    id="bare_single",
    display_name="Bare (single-gain)",
    description=(
        "Pass-through — no Bayer extraction. One channel equal to the "
        "whole frame. Use for monochrome or already-demosaiced sources "
        "where you want to inspect raw pixels."
    ),
    dual_gain=False,
    channels=(ChannelSpec(slot_id="l", default_name="L",
                          loc=(0, 0), color_hint=_C_L),),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(1, 1),
)

BARE_DUALGAIN = ISPMode(
    id="bare_dualgain",
    display_name="Bare (dual-gain)",
    description=(
        "GSense dual-gain pass-through. Two channels: HG-RAW and LG-RAW, "
        "each half of the side-by-side dual-gain frame. No Bayer "
        "demosaic."
    ),
    dual_gain=True,
    channels=(ChannelSpec(slot_id="raw", default_name="RAW",
                          loc=(0, 0), color_hint=_C_RAW),),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(1, 1),
)

RGB_NIR = ISPMode(
    id="rgb_nir",
    display_name="RGB-NIR (GSense dual-gain)",
    description=(
        "GSense dual-gain 4×4 super-pixel with R/G/B/NIR in the four "
        "2×2 sub-tiles. Produces HG-R/G/B/NIR and LG-R/G/B/NIR plus "
        "derived HG-Y / LG-Y luminance. Defaults match extract.py:25-26."
    ),
    dual_gain=True,
    channels=(
        # Byte-identical to legacy LOC: B@(0,0) R@(0,1) G@(1,0) NIR@(1,1).
        ChannelSpec(slot_id="b",   default_name="B",   loc=(0, 0), color_hint=_C_B),
        ChannelSpec(slot_id="r",   default_name="R",   loc=(0, 1), color_hint=_C_R),
        ChannelSpec(slot_id="g",   default_name="G",   loc=(1, 0), color_hint=_C_G),
        ChannelSpec(slot_id="nir", default_name="NIR", loc=(1, 1),
                    renameable=True, color_hint=_C_NIR),
    ),
    default_origin=(0, 0),
    default_sub_step=(2, 2),
    default_outer_stride=(4, 4),
    supports_rgb_composite=True,
)

RGB_IMAGE = ISPMode(
    id="rgb_image",
    display_name="RGB image",
    description=(
        "Standard RGB PNG / TIFF / JPG loaded via PIL or tifffile. Three "
        "colour channels plus Rec.601 luminance Y. No Bayer extraction."
    ),
    dual_gain=False,
    channels=(
        ChannelSpec(slot_id="r", default_name="R", loc=(0, 0), color_hint=_C_R),
        ChannelSpec(slot_id="g", default_name="G", loc=(0, 0), color_hint=_C_G),
        ChannelSpec(slot_id="b", default_name="B", loc=(0, 0), color_hint=_C_B),
    ),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(1, 1),
    supports_rgb_composite=True,
)

GRAYSCALE_IMAGE = ISPMode(
    id="grayscale_image",
    display_name="Grayscale image",
    description="Single-channel PNG / TIFF / JPG — one channel ``L``.",
    dual_gain=False,
    channels=(ChannelSpec(slot_id="l", default_name="L",
                          loc=(0, 0), color_hint=_C_L),),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(1, 1),
)

POLARIZATION_SINGLE = ISPMode(
    id="polarization_single",
    display_name="Polarization (single-gain)",
    description=(
        "2×2 polarization super-pixel at analyzer angles 0°/45°/90°/135°. "
        "Default locs mirror MantisCamUnified cameras/isp/gs_polar. "
        "Channels: I0, I45, I90, I135. Derived Intensity/AoP/DoLP are "
        "computed per analysis request; not exposed as raw channels."
    ),
    dual_gain=False,
    channels=(
        ChannelSpec(slot_id="i0",   default_name="I0",   loc=(0, 0), color_hint=_C_I0),
        ChannelSpec(slot_id="i45",  default_name="I45",  loc=(0, 1), color_hint=_C_I45),
        ChannelSpec(slot_id="i90",  default_name="I90",  loc=(1, 1), color_hint=_C_I90),
        ChannelSpec(slot_id="i135", default_name="I135", loc=(1, 0), color_hint=_C_I135),
    ),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(2, 2),
)

POLARIZATION_DUAL = ISPMode(
    id="polarization_dual",
    display_name="Polarization (GSense dual-gain)",
    description=(
        "GSense dual-gain polarization — 2×2 angle mosaic per half. "
        "Emits HG-{I0,I45,I90,I135} and LG-{I0,I45,I90,I135}."
    ),
    dual_gain=True,
    channels=(
        ChannelSpec(slot_id="i0",   default_name="I0",   loc=(0, 0), color_hint=_C_I0),
        ChannelSpec(slot_id="i45",  default_name="I45",  loc=(0, 1), color_hint=_C_I45),
        ChannelSpec(slot_id="i90",  default_name="I90",  loc=(1, 1), color_hint=_C_I90),
        ChannelSpec(slot_id="i135", default_name="I135", loc=(1, 0), color_hint=_C_I135),
    ),
    default_origin=(0, 0),
    default_sub_step=(1, 1),
    default_outer_stride=(2, 2),
)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

ALL_MODES: Dict[str, ISPMode] = {
    m.id: m for m in (
        BARE_SINGLE,
        BARE_DUALGAIN,
        RGB_NIR,
        RGB_IMAGE,
        GRAYSCALE_IMAGE,
        POLARIZATION_SINGLE,
        POLARIZATION_DUAL,
    )
}


def get_mode(mode_id: str) -> ISPMode:
    """Look up a mode by id; raise KeyError with a clear list on miss."""
    try:
        return ALL_MODES[mode_id]
    except KeyError as exc:
        raise KeyError(
            f"unknown ISP mode {mode_id!r}; "
            f"expected one of {sorted(ALL_MODES)}"
        ) from exc


def default_mode_id_for_source_kind(source_kind: str,
                                    is_dual_gain: bool = False) -> str:
    """Pick a sensible ISP mode when the caller hasn't specified one.

    Preserves pre-initiative behavior:
      * H5 dual-gain recording → ``rgb_nir``
      * 3-channel image       → ``rgb_image``
      * 1-channel image       → ``grayscale_image``
    The returned mode id is guaranteed to exist in ``ALL_MODES``.
    """
    if source_kind == "h5":
        # H5 dual-gain is the only kind currently produced by load_any;
        # keep a single explicit branch so future single-gain H5 support
        # is an obvious place to extend.
        return RGB_NIR.id if is_dual_gain else BARE_SINGLE.id
    if source_kind == "image":
        return RGB_IMAGE.id   # overridden to grayscale_image by caller
                              # when the actual array came back 1-channel.
    if source_kind == "synthetic":
        return RGB_NIR.id
    return RGB_NIR.id


# ---------------------------------------------------------------------------
# Config normalization helpers — the UI can send partial overrides;
# the server normalizes them to full 6-tuple geometry + channel renames.
# ---------------------------------------------------------------------------


def normalize_config(mode: ISPMode,
                     overrides: Optional[Dict[str, object]]) -> Dict[str, object]:
    """Merge per-mode defaults with user overrides; validate ranges."""
    o = dict(overrides or {})

    def _pair(key, default):
        v = o.get(key)
        if v is None:
            return tuple(default)
        if isinstance(v, (list, tuple)) and len(v) == 2:
            return (int(v[0]), int(v[1]))
        raise ValueError(f"{key} must be a 2-tuple, got {v!r}")

    origin = _pair("origin", mode.default_origin)
    sub_step = _pair("sub_step", mode.default_sub_step)
    outer_stride = _pair("outer_stride", mode.default_outer_stride)

    if outer_stride[0] <= 0 or outer_stride[1] <= 0:
        raise ValueError(f"outer_stride components must be >= 1, got {outer_stride}")
    if sub_step[0] < 1 or sub_step[1] < 1:
        raise ValueError(f"sub_step components must be >= 1, got {sub_step}")
    if origin[0] < 0 or origin[1] < 0:
        raise ValueError(f"origin components must be >= 0, got {origin}")

    names = dict(o.get("channel_name_overrides") or {})
    # Silently drop renames on non-renameable slots so a stale localStorage
    # dict from a previous mode can't push garbage into the display.
    renameable = {c.slot_id for c in mode.channels if c.renameable}
    names = {k: str(v) for k, v in names.items() if k in renameable and str(v).strip()}

    # Reject renames that collide with another slot's default_name or with
    # another active rename target. Without this, _apply_mode_to_half's
    # dict-assignment loop silently overwrites one channel with another
    # (e.g. renaming NIR → "R" drops real R data). Fail loud with a
    # ValueError so the PUT /api/sources/{id}/isp endpoint returns 4xx
    # and the UI surfaces a toast. See bugfix merged_bug_004.
    slot_by_id = {c.slot_id: c for c in mode.channels}
    for slot_id, new_name in names.items():
        spec = slot_by_id[slot_id]
        # Collides with another slot's (locked) default name.
        for other in mode.channels:
            if other.slot_id == slot_id:
                continue
            if new_name == other.default_name:
                raise ValueError(
                    f"channel_name_overrides[{slot_id!r}]={new_name!r} collides "
                    f"with slot {other.slot_id!r}'s default name in mode "
                    f"{mode.id!r}; pick a name that doesn't shadow another channel."
                )
        # Collides with another active rename target.
        for other_id, other_name in names.items():
            if other_id == slot_id:
                continue
            if new_name == other_name:
                raise ValueError(
                    f"channel_name_overrides[{slot_id!r}]={new_name!r} collides "
                    f"with channel_name_overrides[{other_id!r}]={other_name!r}; "
                    "each renameable channel needs a unique display name."
                )

    # Per-channel loc overrides (isp-modes-v1 follow-up): lets the user
    # point, say, RGB-NIR's R slot at a different 2×2 sub-tile when the
    # sensor orientation doesn't match the mode's defaults. Accepts a
    # dict keyed by ``slot_id`` with [row, col] values. Unknown slot_ids
    # are silently dropped, matching the rename-override convention.
    raw_locs = dict(o.get("channel_loc_overrides") or {})
    known_slots = {c.slot_id for c in mode.channels}
    loc_overrides: Dict[str, object] = {}
    for k, v in raw_locs.items():
        if k not in known_slots:
            continue
        if not (isinstance(v, (list, tuple)) and len(v) == 2):
            raise ValueError(
                f"channel_loc_overrides[{k!r}] must be a 2-tuple, got {v!r}"
            )
        r, c = int(v[0]), int(v[1])
        if r < 0 or c < 0:
            raise ValueError(
                f"channel_loc_overrides[{k!r}] components must be >= 0, got {v!r}"
            )
        loc_overrides[k] = (r, c)

    return {
        "origin": origin,
        "sub_step": sub_step,
        "outer_stride": outer_stride,
        "channel_name_overrides": names,
        "channel_loc_overrides": loc_overrides,
    }


def resolved_channel_name(mode: ISPMode, spec: ChannelSpec,
                          channel_name_overrides: Dict[str, str]) -> str:
    """Apply a rename override if present; else fall back to the default."""
    return channel_name_overrides.get(spec.slot_id, spec.default_name)


def build_channel_keys(mode: ISPMode,
                       channel_name_overrides: Dict[str, str],
                       include_luminance: bool) -> Tuple[str, ...]:
    """The exact list of keys ``load_any()`` / ``reconfigure_isp`` emit.

    ``include_luminance`` tracks whether load_any appends an H5-style
    ``Y`` channel (only true for rgb_nir today, to preserve the frozen
    channel schema at ARCHITECTURE.md Key invariants #3).
    """
    names = [resolved_channel_name(mode, c, channel_name_overrides)
             for c in mode.channels]
    if mode.dual_gain:
        keys = [f"HG-{n}" for n in names] + [f"LG-{n}" for n in names]
        if include_luminance:
            keys += ["HG-Y", "LG-Y"]
    else:
        keys = list(names)
        if include_luminance:
            keys += ["Y"]
    return tuple(keys)
