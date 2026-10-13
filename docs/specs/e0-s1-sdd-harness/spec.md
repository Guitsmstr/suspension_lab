# E0-S1 — SDD harness bootstrap · spec

## Context

Suspension Lab has no product source of truth, no work queue, and no enforced gate: physics, launch, and touch suites exist but nothing requires them before a commit, and story work has no spec/design/tasks trail. This story ports the proven SDD flow from `giv/page` (see D4), adapted to a Vite + three.js game repo.

## Requirements (EARS)

- R1: WHEN story work starts THEN THE SYSTEM SHALL provide a coordinator runbook at `.opencode/agents/sdd.md` describing setup → specify → plan → tasks → implement → validate → converge with stakeholder gates.
- R2: WHEN a story is specified THEN THE ARTIFACTS SHALL live in `docs/specs/<story>/` as `spec.md` (EARS, no HOW), `design.md` (HOW + pillar sections), `tasks.md` (one task = one commit).
- R3: WHEN any commit is created THEN THE GATE `./scripts/validate.sh` SHALL pass first (pre-commit hook, no bypass).
- R4: WHEN code changes are staged on `main` THEN THE GATE SHALL reject paths outside `docs/`, `AGENTS.md`, `.opencode/` with a message pointing at the story-branch flow.
- R5: WHEN a product or technical decision is made THEN AN ADR SHALL be appended to `docs/decisions.md` in the gate-enforced format.
- R6: WHEN a story changes state THEN `docs/backlog.md` SHALL reflect it.
- R7: WHEN the stakeholder must decide anything THEN THE COORDINATOR SHALL ask via the `question` tool, never plain-prose lists.
