"""Quick inspector: dump metadata and save a preview of HG/LG/RGB."""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mantisanalysis.extract import load_recording, split_dual_gain, extract_rgb_nir, make_rgb_image


def main(path: str, out_dir: Path) -> None:
    rec = load_recording(path)
    print(f"path        : {rec.path}")
    print(f"n_frames    : {rec.n_frames}")
    print(f"frame shape : {rec.shape}  (full dual-gain HG|LG)")
    print(f"dtype       : {rec.frames.dtype}")
    print(f"int_time us : min={rec.int_time.min()} max={rec.int_time.max()} mean={rec.int_time.mean():.1f}")
    print("camera attrs:")
    for k, v in rec.attrs.items():
        print(f"  {k}: {v}")

    f0 = rec.frames[0]
    hg, lg = split_dual_gain(f0)
    print(f"HG shape: {hg.shape}, LG shape: {lg.shape}")
    print(f"HG  min={hg.min()} max={hg.max()} mean={hg.mean():.1f}")
    print(f"LG  min={lg.min()} max={lg.max()} mean={lg.mean():.1f}")

    hg_ch = extract_rgb_nir(hg)
    lg_ch = extract_rgb_nir(lg)
    for tag, ch in (("HG", hg_ch), ("LG", lg_ch)):
        for k, a in ch.items():
            print(f"  {tag}.{k:<3} shape={a.shape} min={a.min()} max={a.max()} mean={a.mean():.1f}")

    out_dir.mkdir(parents=True, exist_ok=True)

    def _stretch(img: np.ndarray, lo: float = 1.0, hi: float = 99.0) -> np.ndarray:
        a = img.astype(np.float32)
        vmin, vmax = np.percentile(a, [lo, hi])
        if vmax <= vmin:
            vmax = vmin + 1
        return np.clip((a - vmin) / (vmax - vmin), 0, 1)

    fig, axes = plt.subplots(2, 4, figsize=(16, 8))
    for col, (tag, ch) in enumerate((("HG", hg_ch), ("LG", lg_ch))):
        rgb = make_rgb_image(ch)
        rgb_disp = _stretch(rgb)
        axes[col, 0].imshow(rgb_disp)
        axes[col, 0].set_title(f"{tag}: RGB composite")
        for j, k in enumerate(("R", "G", "B")):
            axes[col, j + 1].imshow(_stretch(ch[k]), cmap="gray")
            axes[col, j + 1].set_title(f"{tag}: {k}")
    for ax in axes.ravel():
        ax.axis("off")
    fig.suptitle(f"frame 0 of {Path(path).name}", fontsize=11)
    fig.tight_layout()
    fig.savefig(out_dir / "inspect_frame0.png", dpi=120)
    plt.close(fig)
    print(f"\nwrote {out_dir / 'inspect_frame0.png'}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: inspect_recording.py <h5-path> [out-dir]")
        sys.exit(1)
    p = sys.argv[1]
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "outputs"
    main(p, out)
