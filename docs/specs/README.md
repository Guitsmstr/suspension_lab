# SDD spec conventions

Per-story artifacts live in `docs/specs/<story-id>/` (e.g. `docs/specs/e0-s1-sdd-harness/`). Written by the `spec-author` role from coordinator briefs; approved by the stakeholder at each phase gate. Workflow and roles: see `AGENTS.md` and decision D4.

## spec.md — WHAT and WHY, never HOW

- User stories with context.
- Requirements in **EARS notation**, numbered:

  ```
  R1: WHEN the player holds GAS on a phone
      THE SYSTEM SHALL report throttle = 1 to the simulation
  ```

- Ambiguities are marked, never guessed: `[NEEDS CLARIFICATION: specific question]`.
- A spec is not ready for approval while any `[NEEDS CLARIFICATION]` marker remains.
- No tech stack, no code structure, no implementation details.

## design.md — HOW

- Architecture and components; data contracts when applicable.
- **Pillar sections are mandatory**: how the design satisfies RNF-02 (performance) and RNF-04 (correctness). Reference the relevant source files.
- Alternatives considered; links to ADRs in `docs/decisions.md` for decisions taken.

## tasks.md — executable plan

- Ordered checklist; every task is one commit (`task N → one conventional commit`).
- Tasks that can run in parallel carry the `[P]` marker (same level = same wave).
- Every task implicitly ends with: run `./scripts/validate.sh`; fix before moving on.
- `[NEEDS CLARIFICATION]` is forbidden here — tasks are generated only after the spec is approved (enforced by the gate).
- Status checkboxes (`[ ]`/`[x]`) are updated during implementation.
- **Evidence is recorded from tooling, never from memory:** gate evidence by quoting `./scripts/validate.sh` output; browser evidence by quoting `pnpm check:launch` / `pnpm check:touch` lines verbatim plus the `.launch/` screenshots they save. Quote tooling numbers verbatim; never paraphrase or re-derive them.

## Story states

`draft` → `refined` → `ready` → `in progress` → `done` (or `postponed`) — tracked in `docs/backlog.md`.

## Done gate (per story)

1. Deterministic gate green (`./scripts/validate.sh`).
2. `validator` review PASS (adversarial, spec + pillars).
3. **Driving-affecting stories:** stakeholder functional review — the stakeholder exercises the story's visible behavior (default: local `pnpm dev`, on phone via the LAN URL for touch stories) and explicitly approves before `done`. Suite screenshots are supporting evidence, never the approval.
