# Pi Orchestrator — Handoff v3

**Date:** 2026-04-03
**Repo:** `learn-claude-agents` — **main branch**
**Working dir:** `/Users/howard/learn-claude-agents`

---

## What Was Done (This Session)

### Gap A — Post-Signal Verification ✅ Complete

| Step | Result |
|------|--------|
| Gap A plan written | ✅ `docs/superpowers/plans/2026-04-02-gap-a-post-signal-verification.md` |
| `agent-runner.ts` — SHA verification added | ✅ committed `1ea045e2` |
| `index.ts` — baseSha wired in | ✅ committed `5fd09f0c` |
| 39 tests pass (was 38) | ✅ |
| **Pushed to GitHub** | ❌ Not done — local only |

### What Gap A Does

**Problem:** Agent could output `<ready-for-review/>` without actually committing anything. Orchestrator had no way to detect this — it would proceed to create an empty PR.

**Fix (2 files):**

1. `packages/orchestrator/src/agent-runner.ts`
   - `run()` now accepts 4th param: `baseSha?`
   - After seeing `<ready-for-review/>`, reads current HEAD SHA
   - If HEAD SHA === baseSha → rejects with `"made no commit"` error
   - If HEAD SHA changed → resolves normally ✅

2. `packages/orchestrator/src/index.ts`
   - `agentRunner.run(prompt, model, undefined, wt.baseCommitSha)`
   - `wt.baseCommitSha` = SHA recorded by `WorktreeManager.create()` before agent runs

---

## How to Start the Next Session

```bash
cd /Users/howard/learn-claude-agents
claude .

# Verify state
git log --oneline -5          # should show 2 Gap A commits on top
cd packages/orchestrator && bun run test   # 39 pass, 1 skipped
```

---

## V1 E2E Status (for reference)

Last E2E run reached:

```
[task-hello] Worktree created                         ✅
[task-hello] claude -p agent spawned                  ✅
[task-hello] Agent adds // hello from orchestrator    ✅
[task-hello] Agent runs bun run test                  ✅
[task-hello] Agent commits + <ready-for-review/>      ✅
[PR] Push branch + create PR on HOWARD1021/pi-mono    ✅  (PR #3)
[task-hello] Local CI pass                            ✅
[task-hello] Cloud CI pass                            ✅
[ReviewOrchestrator] claude -p review                 ← NEVER REACHED (API limit)
[Notifier] Telegram                                   ← NEVER REACHED
```

To re-run the full E2E:
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

bun packages/orchestrator/orchestrate.ts /tmp/hello-spec.md
```

---

## Next Work: Remaining V2 Gaps

| Gap | Status | Problem | Files | Effort |
|-----|--------|---------|-------|--------|
| **A** — Post-signal verification | ✅ Done | Agent could lie about committing | `agent-runner.ts`, `index.ts` | — |
| **B** — Rich failure memory | ⬜ Next | FailureExtractor only records test names, not what approach was tried | `failure-extractor.ts`, `prompt-builder.ts` | Medium |
| **C** — Restart recovery | ⬜ | Crashed tasks become orphans in registry | `index.ts`, `task-registry.ts` | Low |
| **D** — 4-reviewer parallel | ⬜ | Only 1 reviewer; should be 4 in `Promise.all()` | `review-orchestrator.ts` | Medium |

### Gap B — Rich Failure Memory (start here next)

**Problem:** `FailureExtractor` captures test names but not the *approach* the agent tried. Retry prompt says "failed tests: X" but not "you tried approach Y, which failed because Z."

**Fix:**
- `failure-extractor.ts` — also extract what approach the agent attempted (from stdout/commit message)
- `prompt-builder.ts` — inject "In attempt N you tried [approach]. Do NOT repeat this."

Plan to write: `docs/superpowers/plans/YYYY-MM-DD-gap-b-rich-failure-memory.md`

---

## Architecture Quick Reference

```
orchestrate(spec.md)
  └─ TaskScheduler.run(tasks)
       └─ runTaskWithRetry(task)
            ├─ WorktreeManager.create()          → git worktree add; records baseCommitSha
            ├─ AgentRunner.run(prompt, baseSha)  → claude -p subprocess; verifies SHA changed ← Gap A ✅
            ├─ createOrUpdatePR()                → git push + gh pr create
            ├─ CIRunner.runLocal()               → bun run test in packages/orchestrator/
            ├─ CIRunner.runCloud()               → gh pr checks --watch
            ├─ ReviewOrchestrator.review()       → claude -p "review this diff"
            └─ Notifier.notifyReady()            → Telegram or console.log
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/orchestrator/orchestrate.ts` | CLI entry point |
| `packages/orchestrator/src/index.ts` | Core loop: `orchestrate()` + `runTaskWithRetry()` |
| `packages/orchestrator/src/agent-runner.ts` | Spawns `claude -p`, detects `<ready-for-review/>`, verifies SHA |
| `packages/orchestrator/src/ci-runner.ts` | Local + cloud CI |
| `packages/orchestrator/src/review-orchestrator.ts` | AI code review |
| `packages/orchestrator/src/prompt-builder.ts` | Builds agent prompt with Completion Gate |
| `packages/orchestrator/src/failure-extractor.ts` | Extracts failure info for retry prompts |
| `packages/orchestrator/src/worktree-manager.ts` | `git worktree add/remove/reset` |
| `packages/orchestrator/src/task-registry.ts` | Task state persistence (`.clawdbot/active-tasks.json`) |

## Tests

```bash
cd packages/orchestrator
bun run test
# 39 pass, 1 skipped (E2E smoke requires live Claude API)
```

## Skill

Pi Orchestrator skill saved at: `~/.claude/skills/PiOrchestrator/SKILL.md`

Workflows:
- `RunE2E.md` — step-by-step E2E execution guide
- `ImplementGap.md` — Gap A/B/C/D implementation reference
