# Decisions (ADR log)

Format (gate-enforced): `## D# — title · yyyy-mm-dd · status`
Status: `accepted` | `pending` | `postponed` | `superseded`.

## D1 — Fixed-step 1/300 s physics decoupled from render · 2026-10-01 · accepted

The tire model is too stiff for frame-rate steps. `Vehicle.step` runs at `PHYSICS_DT = 1/300 s` with an accumulator, capped substeps, and a max-frame-dt clamp; render interpolates between substeps. Guarantees RNF-01 determinism.

## D2 — Single source for tunable parameters · 2026-10-01 · accepted

Every adjustable parameter is declared in `src/vehicle/params.ts` (`PARAM_SPECS`); the UI panel is generated from it and car presets apply through `ParamStore`. No orphan constants in UI or physics code.

## D3 — Analytic terrain shared by physics and mesh · 2026-10-01 · accepted

`Terrain.heightAt` is the single height source; the render mesh and road carving derive from it, so physics and visuals can never disagree (RNF-03).

## D4 — Adopt spec-driven development (GIV port) · 2026-10-14 · accepted

Port the SDD flow from `giv/page`: `docs/spec.md` source of truth, per-story `docs/specs/<story>/` artifacts, `sdd` coordinator runbook, spec-author/implementer/validator roles, `./scripts/validate.sh` gate with pre-commit hook, one branch per story, stakeholder gates via the `question` tool. Adaptations vs GIV: pillars are performance + correctness (no security pillar — no secrets/forms backends here); roles run through the available `subagent` tool (no model tiering, no `jev_route` task router); the gate runs typecheck + physics tests + build (browser suites stay per-story manual); docs/code/commits in English, UI copy in Spanish.

## D5 — Gate files bootstrap exemption · 2026-10-14 · accepted

`scripts/validate.sh` and `.githooks/*` are outside the `main` allowlist so the gate cannot be weakened casually — but that blocks the initial harness install itself. Exemption: those paths may be ADDED on `main` only when absent from HEAD (one-time bootstrap); any later change requires a story branch. Implemented in the branch-policy step; no `--no-verify` bypass was used to land the harness.
