# Status — bundler-migration-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (M0 scaffold + Phase 1 in progress)

## Current branch

`main`.

## Current focus

Phase 1 — Vite infrastructure alongside existing CDN path.

## Progress

- [ ] Phase 1 — infrastructure
- [ ] Phase 2 — shared.jsx to ES modules
- [ ] Phase 3 — remaining 6 files + kill CDN
- [ ] Phase 4 — ESLint + Prettier
- [ ] Phase 5 — TypeScript gradual migration
- [ ] Phase 6 — axe-core integration
- [ ] Phase 7 — Storybook + initial stories
- [ ] Phase 8 — docs + close

## Phase 1 tasks

- [ ] `package.json` at repo root
- [ ] `vite.config.js`
- [ ] `web/src/main.jsx` minimal entry
- [ ] `.gitignore` updates
- [ ] `scripts/doctor.py` Node/npm checks (WARN-level)
- [ ] `npm install` runs clean
- [ ] `npm run build` emits `web/dist/`
- [ ] `npm run dev` boots on :5173
- [ ] `SETUP_AND_RUN.md` + `TOOLS_AND_SKILLS.md` updates
- [ ] Tier 0-3 + pytest green
- [ ] Commit + push

## Next concrete action

Create `package.json` at repo root with Vite 5 + React 18 +
@vitejs/plugin-react + minimal scripts.
