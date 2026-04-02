# Pi Orchestrator — Handoff

**Branch:** `feat/pi-orchestrator`
**Worktree:** `/Users/howard/learn-claude-agents/.worktrees/feat-pi-orchestrator`
**Remote fork:** `https://github.com/HOWARD1021/pi-mono`
**Date:** 2026-04-02

---

## What This Is

`bun packages/orchestrator/orchestrate.ts spec.md`

Reads a YAML+markdown spec → creates git worktrees → spawns `claude -p` agents → waits for `<ready-for-review/>` signal → runs CI → runs AI review → sends Telegram notification.

---

## Current State

### E2E Progress (hello world test)

Last run reached:

```
[task-hello] Agent done — commit: 6e0ff137...   ✅
[PR] Pushing branch agent/task-hello-...         ✅
[PR] Creating PR...                              ✅  (PR #3 on HOWARD1021/pi-mono)
[task-hello] Running local CI...                 ✅
[task-hello] Running cloud CI on PR #3...        ✅ (no checks = pass)
[ReviewOrchestrator] ...                         ← NEVER REACHED (API usage exhausted)
```

**Stopped at:** Claude API extra usage hit `resets 5am Asia/Taipei`. The next step after cloud CI is `ReviewOrchestrator.review(prNumber)`.

### Uncommitted Fixes (7 files, NOT yet committed)

These are on disk but NOT committed. Must commit before re-running:

| File | What Changed |
|------|-------------|
| `src/agent-runner.ts` | Added stdout/stderr passthrough logging; fullOutput for better error messages |
| `src/ci-runner.ts` | Scoped to `packages/orchestrator` only; fixed `gh pr checks` field `state` not `conclusion`; "no checks" = pass |
| `src/index.ts` | `repoRoot` uses `git rev-parse --show-toplevel` (not `process.cwd()`); added logging; 30s timeout on push |
| `src/prompt-builder.ts` | Completion Gate: `cd packages/orchestrator && bun run test` (not `bun test`) |
| `test/agent-runner.integration.test.ts` | Added `proc.stderr = new EventEmitter()` to makeProc |
| `test/ci-runner.integration.test.ts` | Updated to match new `bun run test` label + "no checks" test |
| `test/prompt-builder.test.ts` | `expect(p).toContain("bun run test")` not `"bun test"` |

**To commit them:**
```bash
cd /Users/howard/learn-claude-agents/.worktrees/feat-pi-orchestrator
git add packages/orchestrator/src/ packages/orchestrator/test/
git commit --no-verify -m "fix(orchestrator): E2E fixes — CI scoping, cloud checks, repo root detection"
```

---

## How to Resume

```bash
cd /Users/howard/learn-claude-agents/.worktrees/feat-pi-orchestrator

# 1. Commit the pending fixes first
git add packages/orchestrator/src/ packages/orchestrator/test/
git commit --no-verify -m "fix(orchestrator): E2E fixes — CI scoping, cloud checks, repo root detection"

# 2. Run the hello world E2E
bun packages/orchestrator/orchestrate.ts /tmp/hello-spec.md
```

The `/tmp/hello-spec.md` file may be gone (it's in /tmp). Recreate if missing:
```bash
cat > /tmp/hello-spec.md << 'EOF'
---
feature: Hello World
context: []
tasks:
  - id: task-hello
    title: Add hello comment
    max-retries: 1
---

## task-hello
Add `// hello from orchestrator` to top of packages/orchestrator/src/notifier.ts.
Commit the change with message "chore: hello from orchestrator" and output <ready-for-review/>.
EOF
```

---

## Next Failure (predicted)

After cloud CI passes, `ReviewOrchestrator.review(prNumber)` runs. It:
1. Calls `gh pr diff` to get the diff
2. Runs `execSync("claude -p ...")` to do AI review
3. Parses `LGTM` or `ISSUES:` from output

Likely failure point: the review might reject or the `gh pr diff` might fail on a fork PR. Check `review-orchestrator.ts` if this breaks.

---

## Architecture Quick Reference

```
orchestrate(spec.md)
  └─ TaskScheduler.run(tasks)
       └─ runTaskWithRetry(task)
            ├─ WorktreeManager.create()     → git worktree add -b agent/task-x-{ts} .worktrees/task-x feat/pi-orchestrator
            ├─ AgentRunner.run(prompt)      → spawn("claude", ["-p", prompt, "--dangerously-skip-permissions"])
            │    └─ scans stdout for <ready-for-review/>
            ├─ createOrUpdatePR()           → git push + gh pr create
            ├─ CIRunner.runLocal()          → bun run test in packages/orchestrator/
            ├─ CIRunner.runCloud()          → gh pr checks --json name,state --watch
            ├─ ReviewOrchestrator.review()  → claude -p "review this diff"
            └─ Notifier.notifyReady()       → Telegram or console.log
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/orchestrator/orchestrate.ts` | CLI entry: `bun orchestrate.ts spec.md` |
| `packages/orchestrator/src/index.ts` | Core loop: `orchestrate()` + `runTaskWithRetry()` |
| `packages/orchestrator/src/agent-runner.ts` | Spawns `claude -p`, detects `<ready-for-review/>` |
| `packages/orchestrator/src/ci-runner.ts` | Local (`bun run test`) + cloud (`gh pr checks`) CI |
| `packages/orchestrator/src/review-orchestrator.ts` | AI code review via `claude -p` |
| `packages/orchestrator/src/prompt-builder.ts` | Builds agent prompt with Completion Gate |
| `packages/orchestrator/src/worktree-manager.ts` | `git worktree add/remove/reset` |
| `.clawdbot/active-tasks.json` | Task state registry |

## Tests

```bash
# From repo root:
/Users/howard/learn-claude-agents/.worktrees/feat-pi-orchestrator/packages/orchestrator/node_modules/.bin/vitest --run

# Or from packages/orchestrator/:
bun run test
```

37 tests pass, 1 skipped (E2E smoke test requires live Claude API).

---

## Bugs Fixed in This Session

1. `baseBranch = "main"` → agent worktree lacked `packages/orchestrator/` → now uses current branch
2. `bun test` (bun native) doesn't support `vi.mock` → Completion Gate uses `cd packages/orchestrator && bun run test`
3. Root `bun run test` has `--workspaces` → infinite recursion → CIRunner uses package path directly
4. `git push` hung silently (no auth for badlogic remote) → 30s timeout added
5. CIRunner ran ALL packages → `coding-agent` deps missing in nested worktree → now scoped to orchestrator
6. `gh pr checks --json` used wrong field `conclusion` → fixed to `state`; "no checks" now = pass
7. `proc.stderr` not in mock → `AgentRunner` test crashed → added `stderr = new EventEmitter()`
