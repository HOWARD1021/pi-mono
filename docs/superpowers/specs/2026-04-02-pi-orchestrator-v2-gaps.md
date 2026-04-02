# Pi Orchestrator v2 — Gap Analysis

**Date:** 2026-04-02
**Status:** Draft — brainstorming in progress
**Repo:** `learn-claude-agents` / branch `feat/pi-orchestrator`

---

## Background

The v1 Pi Orchestrator E2E loop is proven:
- Worktree creation ✅
- `claude -p` agent subprocess ✅
- `<ready-for-review/>` signal detection ✅
- Local CI ✅
- Cloud CI (`gh pr checks`) ✅
- ReviewOrchestrator → (API limit reached, not fully validated)

The v1 implementation captures the *skeleton* of three reference patterns but has meaningful gaps in each.

---

## Reference Patterns

| Pattern | Source | Core idea |
|---------|--------|-----------|
| **Autoresearch** | Karpathy | Outer loop: CI pass/fail as keep/discard metric; git as memory |
| **Two-tier context** | Elvis / OpenClaw | Separate long-term context from short-term task state; task registry; worktrees |
| **Ralph** | Ralph Wiggum | Inner loop: agent self-verifies via completion promise, cannot lie to exit |

---

## Gap A — No Post-Signal Verification (Ralph pattern)

**What's missing:** After the agent outputs `<ready-for-review/>`, the orchestrator accepts the signal immediately without independent verification.

**Why it matters:** The Ralph pattern's entire value is "the agent cannot lie to exit." But currently, an agent could output the signal before tests pass or before committing. The prompt says "you cannot lie" but there's no enforcement.

**What should happen:**
After signal detected, orchestrator independently verifies:
1. A new commit exists on the branch (SHA changed since task started)
2. Local tests pass when run independently by the orchestrator (not just the agent's self-report)

**Files:** `packages/orchestrator/src/agent-runner.ts`, `packages/orchestrator/src/index.ts`

---

## Gap B — Shallow Failure Memory (Karpathy autoresearch pattern)

**What's missing:** `FailureExtractor` extracts `{ summary, failedTests, approach }` but the `approach` field (what the previous attempt *tried*) is not prominently injected into the next attempt's prompt. The prompt only says "these tests failed" — not "you tried approach X and it failed for reason Y, try something different."

**Why it matters:** Karpathy's autoresearch intelligence lives in the memory injection. Without "approach tried + why it failed," the agent may retry the same strategy. The `attemptHistory` exists but is shallow.

**What should happen:**
Each `FailureExtractor` output should include:
- What specific approach was attempted (code strategy, not just test names)
- Why that approach failed (root cause, not just error message)
- What NOT to try again

The prompt injection should make this explicit: "In attempt N you tried [approach]. Do NOT repeat this."

**Files:** `packages/orchestrator/src/failure-extractor.ts`, `packages/orchestrator/src/prompt-builder.ts`

---

## Gap C — No Restart Recovery (Elvis / OpenClaw pattern)

**What's missing:** `TaskRegistry` stores `status: "running"` and `getRunning()` exists, but `index.ts` has no startup check for in-progress tasks. If the orchestrator crashes mid-run, tasks are orphaned.

**Why it matters:** The spec explicitly says: "on orchestrator restart, tasks marked `running` are treated as failed attempts and re-entered into the outer loop at attempt N+1."

**What should happen:**
At startup, before processing the spec, `orchestrate()` should:
1. Call `registry.getRunning()`
2. For each running task, increment attempt count and re-enter outer loop
3. (No RpcClient reconnect — spawn fresh subprocess for the new attempt)

**Files:** `packages/orchestrator/src/index.ts`, `packages/orchestrator/src/task-registry.ts`

---

## Gap D — ReviewOrchestrator: 1 reviewer instead of 4 (design spec)

**What's missing:** Design calls for 4 parallel AI reviewers in `Promise.all()`:
- **Codex** — edge cases, race conditions, logic errors
- **Copilot** — GitHub-native context, repo conventions
- **Gemini** — security, accessibility
- **Claude Sonnet** — validation, flags critical issues only

**Current implementation:** 1 `claude-haiku` reviewer, sequential, no parallelism.

**Why it matters:** The 4-reviewer pattern provides diverse perspectives. Using haiku instead of sonnet for code review reduces quality. The `Promise.all()` parallelism is the Elvis pattern applied to review.

**What should happen:**
- Restore 4-reviewer `Promise.all()` structure
- Use appropriate models per reviewer role
- Degrade gracefully if API keys missing (skip that reviewer, don't block)

**Files:** `packages/orchestrator/src/review-orchestrator.ts`

---

## Summary Table

| Gap | Pattern | Impact | Effort |
|-----|---------|--------|--------|
| A — No post-signal verification | Ralph | High reliability | Low |
| B — Shallow failure memory | Karpathy | High intelligence | Medium |
| C — No restart recovery | Elvis | Medium robustness | Low |
| D — 1 reviewer vs 4 parallel | Design spec | Medium quality | Medium |

---

## Next Steps (TBD)

- [ ] Decide which gaps to address in v2
- [ ] Propose 2-3 implementation approaches
- [ ] Write full v2 design spec
- [ ] Create implementation plan
