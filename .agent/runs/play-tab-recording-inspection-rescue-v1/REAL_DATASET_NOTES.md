# Real Dataset Notes — `/Users/zz4/Desktop/day5_breast_subject_1`

Probed 2026-04-25 with `h5py` (read-only inspection of three representative files).

## Folder summary

- **33 `.h5` files**, all `167,792,856` bytes (167.79 MB) — uniform shape and frame count.
- Naming pattern: `sample_{N}_view_{V}_exp_{X}.h5` ± optional `_2026-02-19_HH-MM-SS_NNN` timestamp suffix.
- No sub-folders.
- **No dark-frame H5s present.** No filenames containing `dark`, `bg`, `cal`, `ref`, `cover`. The Play mode must treat the dark-frame UI's empty state as a normal warning, not a blocker.

## Per-file structure (uniform across all probed files)

```
ROOT_ATTRS:
    hardware-info  (JSON string — Apple M4 Pro, 48 GB RAM)
    network-info   (JSON string — interfaces + MAC)
    os-info        (JSON string — Darwin 25.2.0)
    python-info    (JSON string — Python 3.12.12 + pkg list incl. h5py 3.15.1, numpy 2.2.6, MantisCam 0.2.0)
    sw-version     ('alpha')
    time-info      (JSON string — UTC + local + tz + epoch)

camera/                                     (Group)
  frames                                    Dataset shape=(10, 2048, 4096, 1) dtype=uint16
                                            chunks=(1, 2048, 4096, 1)  ← one chunk per frame
  integration-time                          Dataset shape=(10,) dtype=float64
                                            (units: SECONDS — values 0.005 – 0.4)
  integration-time-expected                 Dataset shape=(10,) dtype=float64
  timestamp                                 Dataset shape=(10,) dtype=float64
                                            (Unix epoch seconds)
```

## Sampled files

| File | exposures (s, unique) | ts[0] (epoch) | ts[-1] (epoch) | dt (s) | frame0 min/max/mean |
|---|---|---|---|---|---|
| `sample_1_view_1_exp_0.005.h5` | `{0.005}` | 1771577522.7209 | 1771577523.1264 | 0.4055 | 1504 / 49824 / 6939 |
| `sample_1_view_2_exp_0.3.h5` | `{0.3}` | 1771577442.3805 | 1771577444.9552 | 2.5747 | 688 / 65520 / 2676 |
| `sample_4_view_3_exp_0.1.h5` | `{0.1}` | 1771491245.9920 | 1771491246.8496 | 0.8577 | 1504 / 65520 / 15131 |

Observations:
- All 10 frames in a given file share **one** integration time — within-file exposure is constant.
- `dt` ≈ 10 frames at the implied capture rate (0.005 s exp → ~25 fps; 0.3 s exp → ~3.6 fps; 0.1 s exp → ~10.5 fps).
- Pixel values typically 12-bit-in-uint16 with occasional saturation at 65520.

## Channel layout (after existing extractor)

The frame is `(2048, 4096, 1)` uint16. The existing project conventions apply unchanged:

1. `extract.py::load_recording` reads via `f["camera"]["frames"]`.
2. `extract.py::split_dual_gain` splits 4096 wide → HG (left 2048) + LG (right 2048).
3. `isp_modes::RGB_NIR` is the default mode for dual-gain H5; channel keys produced:
   - `HG-R, HG-G, HG-B, HG-NIR, HG-Y` (Y synthesized via Rec.601 from R/G/B)
   - `LG-R, LG-G, LG-B, LG-NIR, LG-Y`
4. After 4-pixel-stride extraction: each channel array is `1024 × 1024` uint16.
5. GSense bayer constants `ORIGIN = (0, 0)` and `LOC = {B: (0,0), R: (0,1), G: (1,0), NIR: (1,1)}` (locked physical layout — see `CLAUDE.md` rule #4).

## What this means for Play mode

- **Streams within this folder are NOT continuous** — files are independent shots taken at different times, exposures, and "views". Stream Builder's continuity warnings will fire on most multi-file groupings. That is correct, not a bug.
- **Frame indexing budget**: 10 frames × 16 MB raw = 160 MB if a whole file is loaded; reading one chunk at a time is much cheaper. Use `f["camera"]["frames"][idx]` for lazy reads.
- **Default playback FPS**: at 0.005 s exposure the files run ~25 fps natively; 30 fps default works.
- **Dark-frame warning**: the dataset folder has none. The Sources panel's Dark section must show a clean "No dark frame loaded — dark correction unavailable" empty state, not an error.
- **Backend `load_recording` already works** on these files unmodified — confirmed by direct h5py probe + cross-reference against [extract.py:47](../../../mantisanalysis/extract.py).

## Notes on metadata edge cases

- All files have `time-info` and `integration-time`. **No missing-metadata cases observed in this folder.** The `W-META-TS` / `W-META-EXP` warning paths still need to exist for files that do lack these, but won't be exercised by this dataset.
- Two files share the same nominal exposure but were captured ~80 s apart (`sample_1_view_2_exp_0.3` ts0=...442 vs. `sample_1_view_2_exp_0.3_2026-02-20_08-51-06_411.h5`) — the timestamp suffix in the filename matches the actual capture time. Stream Builder grouping by exposure alone would mis-merge these; correct grouping uses `(exposure, sample_id, view_id, timestamp_proximity)`. v1 will rely on user reorder + the continuity warning.
