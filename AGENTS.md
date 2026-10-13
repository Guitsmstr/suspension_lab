# Suspension Lab — Agent Constitution

Vite + TypeScript + three.js driving game with a real-time multi-body suspension model. **pnpm** exclusively.

**Language rule: user-facing UI copy in Spanish. Everything else — code, tests, docs, commit messages — in English.** (Pre-existing Spanish comments/docs stay as-is; new content follows this rule.)

## Hard rules

1. **Spec-driven.** `docs/spec.md` is the product source of truth. Story work runs through the `sdd` coordinator (runbook: `.opencode/agents/sdd.md`); its artifacts live in `docs/specs/<story>/`. Direct implementation without spec/design/tasks approval is only for one-line fixes, typos, or mechanical renames.
2. **Two pillars, non-negotiable: performance and correctness** (RNF-02/RNF-04 in `docs/spec.md`). Simulation determinism (fixed-step physics, zero per-step allocations) and a clean console / green launch suite are never traded for features.
3. **Deterministic gate.** `./scripts/validate.sh` must pass before every commit; it is enforced by the pre-commit hook. Never bypass it. If the gate fails, fix the code — not the gate.
4. **Stakeholder gates.** The user approves spec, design, and tasks before implementation. Agents never self-approve a phase. Use the `question` tool for every approval — never plain-prose question lists.
5. **Delegation briefs are mandatory.** Every subagent task carries: objective, scope boundaries, expected output format, and file/spec pointers. Never a naked subtask. Point to file paths — never paste file contents into briefs.
6. **Decisions leave a trace.** Any product/technical decision → append an ADR in `docs/decisions.md` (format: `## D# — title · date · status`). Story state changes → update `docs/backlog.md`.
7. **One story = one branch.** Cut `feat/<id>-<slug>` from up-to-date `main` at story start; the whole story (artifacts + implementation + evidence + backlog state) lives on that branch; merge into `main` with `git merge --no-ff` at converge, then delete the branch. Docs/harness housekeeping (allowlist: `docs/`, `AGENTS.md`, `.opencode/`) may go to `main` directly — code commits on `main` are blocked by `./scripts/validate.sh --staged`.

## Commands

- Validate everything: `./scripts/validate.sh` (add `--staged` to skip build-heavy steps on docs-only commits). Runs docs checks always; typecheck/test/build once `package.json` exists.
- `pnpm dev` — dev server at http://127.0.0.1:5173
- `pnpm test` — headless physics suite; must pass before accepting any physics change
- `pnpm check:launch` — full launch validation in headless Chromium (Playwright): clean console, loading screen, camera, keyboard response, error notice; screenshots in `.launch/`
- `pnpm check:touch` — touch-controls validation (desktop hidden / mobile visible and drivable)
- `pnpm build` — typecheck + production build
- `pnpm typecheck` — typecheck only
- Package manager: **pnpm**. No `npm`/`yarn` lockfiles.

## Trigger table (read on demand, only when relevant)

| When | Read / use |
|---|---|
| Starting story work | run the `sdd` coordinator (`.opencode/agents/sdd.md`); pick a `ready` story from `docs/backlog.md` |
| Starting or finishing story work | create/merge the story branch per hard rule 7 (`feat/<id>-<slug>`) |
| Spec/design/tasks conventions unknown | read `docs/specs/README.md` |
| Product question about scope or requirements | read `docs/spec.md` (source of truth) |
| A decision is made (product or technical) | append ADR to `docs/decisions.md` |
| Story state changes | update `docs/backlog.md` |
| Touch/tilt input behavior involved | read `src/ui/touchControls.ts` + `src/input.ts` |

## Repo map (paths only)

- `docs/spec.md` — product source of truth · `docs/decisions.md` — ADR log · `docs/backlog.md` — work queue
- `docs/specs/<story>/` — per-story SDD artifacts (`spec.md`, `design.md`, `tasks.md`)
- `.opencode/agents/` — `sdd` coordinator runbook + `spec-author` / `implementer` / `validator` role briefs
- `scripts/validate.sh` — deterministic gate · `.githooks/` — pre-commit hook
- `src/vehicle/` — physics (no three.js except `Vector3`/`Quaternion`) · `src/render/` · `src/world/` · `src/ui/` · `src/audio/`
- `src/vehicle/params.ts` — every tunable parameter lives here (`PARAM_SPECS` drives the UI panel)

## Convenciones (técnicas, vigentes)

- TypeScript estricto, módulos ES, imports de three.js: `three` y `three/addons/...`.
- La física vive en `src/vehicle/` y no debe depender de three.js salvo por `THREE.Vector3/Quaternion`.
- El bucle de física corre a paso fijo `1/300 s` (`PHYSICS_DT` en `src/main.ts`); el render interpola/actualiza visuales.
- Todo parámetro ajustable se declara en `src/vehicle/params.ts` (el panel de la UI se genera automáticamente de `PARAM_SPECS`).
- El terreno es analítico (`Terrain.heightAt`) y comparten función física y malla: no introducir alturas discrepantes.
- Evitar asignaciones dentro del bucle de física (`Vehicle.step`); usar los vectores temporales de la clase.
