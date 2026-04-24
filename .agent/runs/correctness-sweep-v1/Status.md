# Status — correctness-sweep-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (M0 scaffold)

## Current branch

`main`.

## Current focus

M1 — R-0004 dead-code removal.

## Progress

- [ ] M1 — R-0004 dead code
- [ ] M2 — R-0005 Michelson clamp
- [ ] M3 — R-0009 410 Gone
- [ ] M4 — R-0010 ISP reconfigure invalidation
- [ ] M5 — R-0006 / B-0007 rotate/flip warning
- [ ] M6 — B-0006 legacy CLI smoke
- [ ] M7 — B-0012 doctor.py
- [ ] M8 — Gates + browser verify + close

## Next concrete action

Delete `split_and_extract` from `mantisanalysis/extract.py:112-117`
and verify no callers.
