# E0-S1 — SDD harness bootstrap · design

## Components

- `AGENTS.md` — constitution merged with the existing project instructions (packages, commands, conventions); adds hard rules, trigger table, repo map.
- `docs/{spec,backlog,decisions}.md` — source of truth, work queue, ADR log (seeded D1–D4 from the shipped architecture).
- `docs/specs/README.md` + `docs/specs/e0-s1-sdd-harness/` — conventions and this story's own artifacts.
- `.opencode/agents/{sdd,spec-author,implementer,validator}.md` — coordinator runbook + role briefs. Roles execute through the `subagent` tool (`general` for authoring/implementation, `explore` for codebase recon); no model tiering and no `jev_route` router (GIV-specific, dropped per D4).
- `scripts/validate.sh` — deterministic gate: docs checks always (ADR format, internal links, tasks hygiene), branch policy in `--staged` mode, then typecheck + physics tests + build. No lint (unconfigured → `ok`), no audit, no asset budgets (game assets are heavy by nature).
- `.githooks/pre-commit` → `./scripts/validate.sh --staged`, wired via `core.hooksPath`.

## Pillars

- **RNF-02 performance:** the gate itself stays fast — browser suites (`check:launch`, `check:touch`) are per-story manual evidence, never pre-commit steps. Docs checks are grep-only.
- **RNF-04 correctness:** the gate fails closed (unknown option → exit 1, `set -uo pipefail`); branch policy blocks code-on-main at commit time; full step logs go to a temp dir printed at start and end.

## Alternatives considered

- Full GIV port including `--json` evidence machinery and `gate-summary.js`: dropped — quoting gate output verbatim is sufficient evidence at this repo size; revisit if story throughput demands it.
- `implementer-flash` role: dropped — no model tiering available; mechanical vs standard work splits via `[P]` waves and brief scope instead.

Links: D4.
