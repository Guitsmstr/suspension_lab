#!/usr/bin/env bash
# Deterministic gate — must pass before every commit (wired via .githooks/pre-commit).
# Usage: ./scripts/validate.sh [--staged] [--verbose]
#   --staged    enforce the main-branch policy and skip build-heavy steps
#               when only docs/harness files are staged
#   --verbose   print failing step output in full (default: tail + full log path)
# Every run keeps its full step logs in a temp dir, printed at start and end.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

staged=0
verbose=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --staged) staged=1 ;;
    --verbose) verbose=1 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
  shift
done

errors=0
cur=""
step_n=0
logdir="$(mktemp -d "${TMPDIR:-/tmp}/susplab-gate.XXXXXX")"
: > "$logdir/steps.tsv"
printf '# gate logs: %s\n' "$logdir"

step() { cur="$1"; printf '\n== %s ==\n' "$1"; }
record() { [ -n "$cur" ] && printf '%s\t%s\n' "$cur" "$1" >> "$logdir/steps.tsv"; return 0; }
ok()   { printf 'ok:   %s\n' "$1"; record ok; }
err()  { printf 'FAIL: %s\n' "$1"; errors=$((errors + 1)); record fail; }
show_log() {
  local log="$1"
  if [ "$verbose" -eq 1 ]; then
    cat "$log"
  else
    tail -n 60 "$log"
    printf 'full log: %s\n' "$log"
  fi
}
run_step() {
  local name="$1"; shift
  local slug out
  slug="$(printf '%s' "$name" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//;s/-$//')"
  out="$logdir/$(printf '%02d' "$step_n")-$slug.log"
  step_n=$((step_n + 1))
  if "$@" >"$out" 2>&1; then ok "$name"; else
    err "$name"
    show_log "$out"
  fi
}

# --- Docs checks (always) ----------------------------------------------------

step "ADR format (docs/decisions.md)"
adr_total=$(grep -c '^## D[0-9]' docs/decisions.md 2>/dev/null || true)
adr_bad=$(grep -n '^## D[0-9]' docs/decisions.md 2>/dev/null | grep -vE '^[0-9]+:## D[0-9]+ — .+ · [0-9]{4}-[0-9]{2}-[0-9]{2} · (accepted|pending|postponed|superseded|temporary)' || true)
if [ -n "$adr_bad" ]; then err "malformed ADR heading(s):
$adr_bad"; else ok "$adr_total ADRs well-formed"; fi

step "Internal links (docs + AGENTS.md)"
broken=0
for f in docs/*.md docs/specs/*.md AGENTS.md; do
  [ -f "$f" ] || continue
  while IFS= read -r target; do
    target="${target%%#*}"
    [ -z "$target" ] && continue
    case "$target" in http*|mailto:*) continue ;; esac
    if [ ! -e "$(dirname "$f")/$target" ] && [ ! -e "$target" ]; then
      err "broken link in $f -> $target"; broken=1
    fi
  done < <(grep -oE '\]\([^)]+\)' "$f" | tr -d ']()')
done
[ "$broken" -eq 0 ] && ok "all internal links resolve"

step "Approved-spec hygiene (docs/specs/*/tasks.md)"
if compgen -G 'docs/specs/*/tasks.md' > /dev/null; then
  hits=$(grep -rn 'NEEDS CLARIFICATION' docs/specs/*/tasks.md || true)
  if [ -n "$hits" ]; then err "tasks.md must not contain NEEDS CLARIFICATION:
$hits"; else ok "no unresolved markers in tasks"; fi
else
  ok "no task specs yet"
fi

# --- Branch policy (staged mode only) ----------------------------------------

branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ "$staged" -eq 1 ]; then
  step "Branch policy (staged changes vs. 'main' allowlist)"
  if [ "$branch" = "main" ]; then
    offenders="$(git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null \
      | grep -vE '^(docs/|\.opencode/|AGENTS\.md$)' || true)"
    # Bootstrap exemption (D5): the gate's own files may be ADDED on main once
    # (initial harness install). If they already exist in HEAD, any further
    # change to them needs a story branch like any other code.
    gated=""
    for p in $offenders; do
      case "$p" in
        .githooks/*|scripts/validate.sh)
          if git cat-file -e "HEAD:$p" 2>/dev/null; then gated="$gated
$p"; fi ;;
        *) gated="$gated
$p" ;;
      esac
    done
    offenders="$(printf '%s' "$gated" | sed '/^$/d' || true)"
    if [ -n "$offenders" ]; then
      printf '%s\n%s\n' "$branch" "$offenders" > "$logdir/branch-policy.txt"
      err "branch policy: code changes are not allowed on 'main' — create a story branch \`feat/<story-id>-<slug>\` (see AGENTS.md hard rule 7)
offending path(s):
$offenders"
    else
      printf '%s\n' "$branch" > "$logdir/branch-policy.txt"
      ok "staged paths within 'main' allowlist (docs/, AGENTS.md, .opencode/)"
    fi
  else
    printf '%s\n' "${branch:-detached HEAD}" > "$logdir/branch-policy.txt"
    ok "branch policy ok (branch: ${branch:-detached HEAD} — check active only on 'main')"
  fi
fi

# --- Docs-only mode (for --staged) -------------------------------------------

docs_only=0
if [ "$staged" -eq 1 ]; then
  files=$(git diff --cached --name-only 2>/dev/null || true)
  if [ -n "$files" ] && ! grep -qvE '^(\.opencode/|\.githooks/|scripts/|docs/|AGENTS\.md|opencode\.json|.*\.md$)' <<< "$files"; then
    docs_only=1
    step "Staged set is docs/harness only — skipping build steps"
  fi
fi

# --- Project checks (auto-activate once package.json exists) ------------------

if [ -f package.json ] && [ "$docs_only" -eq 0 ]; then
  has_script() { node -e "process.exit(require('./package.json').scripts['$1']?0:1)" 2>/dev/null; }

  step "Typecheck"
  if has_script typecheck; then run_step "pnpm typecheck" pnpm run typecheck
  elif [ -f tsconfig.json ]; then run_step "tsc --noEmit" pnpm exec tsc --noEmit
  else ok "no typecheck configured"; fi

  step "Lint"
  if has_script lint; then run_step "pnpm lint" pnpm run lint; else ok "no lint configured"; fi

  step "Tests"
  if has_script test; then run_step "pnpm test" pnpm run test
  else ok "no tests configured"; fi

  step "Build"
  if has_script build; then run_step "pnpm build" pnpm run build
  else ok "no build configured"; fi
fi

# --- Result --------------------------------------------------------------------

step "Result"
exit_code=0
if [ "$errors" -gt 0 ]; then
  printf '%d check(s) FAILED\n' "$errors"
  exit_code=1
else
  printf 'all checks passed\n'
fi
printf 'gate logs: %s\n' "$logdir"
exit "$exit_code"
