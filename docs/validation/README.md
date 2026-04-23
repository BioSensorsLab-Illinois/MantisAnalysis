# Real-sample validation (B-0018)

The USAF / FPN / DoF rewrite trio has only been exercised against the
synthetic USAF sample the UI boots into. Before declaring the bench
general-availability, the numbers must be cross-checked against real
MantisCam recordings on the three physical targets below.

**Status**: Blocked on data. This directory is a staging area — drop a
markdown file per recording session with the observed numbers and the
ground-truth reference for comparison.

## Recording plan

1. **USAF 1951 chart** through `USAF` mode. Confirm MTF-at-threshold
   (10 % / 20 % / 50 % Michelson) matches historical lab notes.
2. **Flat-field, no target** through `FPN` mode. Confirm DSNU and PRNU
   against the prior Python-CLI numbers from the pre-rewrite pipeline.
3. **Tilted Edmund 5-15 DoF chart** through `DoF` mode. Confirm the
   Gaussian FWHM matches manual inspection of the focus-sweep images,
   and that the B-0021 tilt correction recovers the sample-plane DoF
   width within measurement uncertainty.

## Where recordings live

Capture recordings go under `outputs/validation/` in the working tree.
`outputs/` is gitignored — never commit raw `.h5` captures. Reference
numbers + plots can be committed here under descriptive filenames:

- `2026-04-NN_usaf-lens-A.md`
- `2026-04-NN_fpn-darkfield-binned.md`
- `2026-04-NN_dof-tilt15deg.md`

Each file should include:

- Date, operator, camera serial, lens + target used
- Exposure / gain / ISP settings as seen in the picker
- Raw metric output (screenshot of the analysis-modal Summary tab)
- Ground-truth reference value + source
- Pass / fail per metric with any offsets explained

## When to close B-0018

Close when (1), (2), and (3) above all agree with historical references
within documented tolerances. At that point the rewrite trio can be
tagged GA and referenced in `DECISIONS.md`.
