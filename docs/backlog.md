# Backlog

Story states: `draft` → `refined` → `ready` → `in progress` → `done` (or `postponed`).

Stories in `draft` need refinement: acceptance criteria, dependencies, and resolution of open questions. Story work runs through the `sdd` coordinator (`.opencode/agents/sdd.md`); per-story artifacts live in `docs/specs/<story>/`.

---

## E0 — SDD harness

- [x] **E0-S1 · SDD harness bootstrap** (constitution, spec, backlog, ADR log, role runbooks, deterministic gate + pre-commit hook) · `done`
  - See D4. Artifacts: `docs/specs/e0-s1-sdd-harness/`. Gate green on landing.

## E1 — Phone driving quality

- [ ] **E1-S1 · Tilt-sign check on a physical device** · `draft`
  - The headless touch suite injects tilt state; the sensor mapping (`devicemotion` lateral axis per screen orientation) is unverified on hardware.
  - Questions: which orientations need checking (portrait/landscape both ways)? Who runs the on-device pass?
- [ ] **E1-S2 · PWA install polish** · `draft`
  - `public/manifest.webmanifest` ships without icons; install prompt and homescreen launch unverified.
  - Questions: icon source (SVG maskable)? Target: Android + iOS homescreen?

## E2 — Simulation depth (to refine)

- [ ] **E2-S1 · Next physics/model iteration** · `draft`
  - No scoped item yet. Candidates surface from driving sessions.
