# Pi Orchestrator — Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Repo:** `learn-claude-agents`

---

## 1. What We're Building

A standalone TypeScript CLI — `bun orchestrate my-spec.md` — that reads a spec file, spawns Pi Agent workers per task, runs CI validation, retries intelligently on failure, runs four parallel AI reviewers, and sends a Telegram notification when a PR is ready for human review.

**Not a daemon. Not a server.** Single process, exits when all tasks complete or exhaust retries.

---

## 2. Inspiration

| Source | Pattern used |
|---|---|
| Elvis / OpenClaw | Two-tier context separation, git worktrees, task registry |
| Karpathy autoresearch | Outer loop: keep/discard per metric (CI pass/fail), git as memory |
| Ralph Wiggum | Inner loop: agent self-verifies via completion promise, cannot lie to exit |

---

## 3. Spec File Format

YAML frontmatter for machine-parseable metadata. Free-form markdown body for task descriptions.

```yaml
---
feature: Custom Templates
context:
  - context/customers/agency-client.md
  - context/decisions/template-system-2026-03.md

tasks:
  - id: task-1
    title: Backend API
    model: claude-opus-4-6        # optional, default: claude-opus-4-6
    max-retries: 3                 # optional, default: 3
    requires-screenshots: false    # optional, default: false

  - id: task-2
    title: Frontend UI
    depends-on: [task-1]           # typed array, validated at parse time
    requires-screenshots: true
---

## task-1

Build POST /api/templates endpoint with full CRUD.
Schema in `src/types/template.ts`. All tests required.

## task-2

Build the templates management page at `/settings/templates`.
Match design in `context/designs/templates-ui.png`.
Include before/after screenshots in the PR.
```

**Validation (fail-fast before any agent spawns):**
- Zod schema validates all frontmatter fields
- All `context` file paths checked to exist
- All `depends-on` references checked against declared task IDs
- All `## task-{id}` sections verified to match frontmatter task IDs

---

## 4. Architecture

```
orchestrate.ts  (entry point: bun orchestrate spec.md)
│
├── SpecParser        — parses + validates spec file via Zod
├── ContextLoader     — reads vault markdown files, trims to ~4k tokens each
├── TaskRegistry      — .clawdbot/active-tasks.json (file-based, survives restart)
│
└── TaskScheduler     — respects depends-on, runs independent tasks in parallel
      │
      └── Per task: runTaskWithRetry()
            │
            ├── WorktreeManager       — git worktree add/remove
            │
            ├── OUTER LOOP (autoresearch pattern, max N attempts)
            │     │
            │     ├── AgentRunner     — RpcClient lifecycle
            │     │     └── INNER LOOP (ralph pattern)
            │     │           Agent self-loops: fix → bun test → fix
            │     │           Exits only when: <ready-for-review/>
            │     │
            │     ├── CIRunner        — local checks → gh pr checks --watch
            │     │     PASS → ReviewOrchestrator
            │     │     FAIL → FailureExtractor → inject context → git reset → retry
            │     │
            │     └── ReviewOrchestrator — 4× RpcClient in Promise.all()
            │           Codex / Copilot / Gemini / Claude (parallel)
            │           Each posts comments on PR via gh cli tool
            │
            └── Notifier              — Telegram on success or human-attention needed
```

---

## 5. The Two Loops

### Inner Loop — Ralph Pattern (agent self-certifies)

The agent's prompt contains the completion gate explicitly:

```
You are implementing: ${task.description}

## Context
${contextChunks}

## Your git history on this branch
${gitLog}   ← previous attempts visible

## Local Completion Gate
Before finishing, run: bun test && tsc --noEmit
Only output <ready-for-review/> when ALL local checks pass.
Do NOT stop until you can output this signal truthfully.

## Previous attempt failures (if any)
${attemptHistory}
```

The agent runs its own fix → test → fix loop. The orchestrator waits for `<ready-for-review/>`. No polling needed.

### Outer Loop — Autoresearch Pattern (orchestrator keeps/discards)

```
for attempt 1..maxRetries:
  run inner loop → wait for <ready-for-review/>
  gh pr create (or update)
  gh pr checks --watch   ← cloud CI = "the metric"

  if CI passes:
    run triple review
    if no critical issues → notify Howard → DONE
    else → treat as failure, inject review issues

  if CI fails:
    FailureExtractor (claude-haiku-4-5) → structured { summary, failedTests, errorOutput }
    inject into next attempt's prompt
    git reset worktree to branch base
    continue loop

if all attempts exhausted:
  Telegram: "task-X needs human attention after N attempts"
  update TaskRegistry status = "failed"
```

---

## 6. Components

### SpecParser
- Input: path to `.md` file
- Output: `ParsedSpec { feature, contextFiles, tasks[] }`
- Validates with Zod, throws `SpecValidationError` with clear message on failure
- Checks all `depends-on` references are valid task IDs

### ContextLoader
- Input: array of file paths
- Output: concatenated markdown string, truncated to max tokens
- Reads from the markdown vault directory
- Graceful error if file missing (warns, continues without it)

### TaskRegistry
- File: `.clawdbot/active-tasks.json`
- Schema: `{ [taskId]: TaskRecord }`
- Atomic writes (write to tmp, rename)
- `getRunning()` — used to resume after crash

### WorktreeManager
- `create(taskId, branch, baseBranch)` → creates worktree + branch, returns path
- `remove(taskId)` → removes worktree
- `reset(worktreePath, baseBranch)` → git reset for retry

### AgentRunner
- Wraps `RpcClient` from `@mariozechner/pi-coding-agent`
- `run(worktreePath, prompt, model, timeout)` → waits for `<ready-for-review/>` in output
- Captures all events for logging
- Returns `AgentResult { summary, gitLog, prDescription }`

### CIRunner
- `runLocal(worktreePath)` → `bun test && tsc --noEmit`
- `runCloud(branch)` → `gh pr checks --watch --interval 30`
- Returns `CIResult { passed, failedChecks, runId, errorOutput }`

### FailureExtractor
- Uses `claude-haiku-4-5` (cheap + fast)
- Input: CI error output (truncated to 3k tokens)
- Output: `{ summary: string, failedTests: string[], approach: string }`
- Used to build the next attempt's `attemptHistory` injection

### ReviewOrchestrator
- Spawns 4 `RpcClient` instances in `Promise.all()`
- Codex: edge cases, race conditions, logic errors
- Copilot: GitHub-native context, repo conventions
- Gemini: security, accessibility, free tier
- Claude Sonnet: validation, flags critical issues only
- Each agent posts review comments via `gh pr review` tool call
- Returns `ReviewResult { passed, criticalIssues[] }`

### Notifier
- Telegram Bot API
- `notifyReady(taskId, prNumber, prUrl)` — PR ready to merge
- `notifyFailed(taskId, attempts, lastError)` — needs human attention

---

## 7. Definition of Done (per task)

```
☐ PR created on isolated branch
☐ Branch has no merge conflicts with main
☐ Local CI passed (bun test + tsc --noEmit)
☐ GitHub Actions CI passed (lint, types, unit, E2E)
☐ Codex review: no critical issues
☐ Copilot review: no critical issues
☐ Gemini review: no critical issues
☐ Claude review: no critical issues
☐ Screenshots included (if requires-screenshots: true)
```

---

## 8. Task Registry Schema

```typescript
interface TaskRecord {
  id: string;
  branch: string;
  worktree: string;
  status: "pending" | "running" | "done" | "failed" | "waiting_review";
  attempts: number;
  maxRetries: number;
  attemptHistory: string[];      // failure context per attempt
  pr?: number;
  prUrl?: string;
  checks?: DefinitionOfDone;
  startedAt: number;
  completedAt?: number;
  model: string;
}
```

---

## 9. File Layout

```
orchestrate.ts              ← entry point
src/
  spec-parser.ts            ← SpecParser + Zod schema
  context-loader.ts         ← ContextLoader
  task-registry.ts          ← TaskRegistry
  worktree-manager.ts       ← WorktreeManager
  agent-runner.ts           ← AgentRunner (wraps RpcClient)
  ci-runner.ts              ← CIRunner (local + cloud)
  failure-extractor.ts      ← FailureExtractor (haiku)
  review-orchestrator.ts    ← ReviewOrchestrator (4 reviewers)
  notifier.ts               ← Telegram notifier
  prompt-builder.ts         ← builds agent prompts with context + history
.clawdbot/
  active-tasks.json         ← TaskRegistry state
```

---

## 10. Error Handling

| Scenario | Behavior |
|---|---|
| Spec validation fails | Throw `SpecValidationError`, exit 1, no agents spawned |
| Context file missing | Warn + continue without that file |
| Agent timeout (>30min) | Kill agent, treat as CI failure, extract from timeout message |
| Worktree creation fails | Abort task, mark failed, continue other tasks |
| GitHub CLI not authenticated | Fail fast at startup, not mid-run |
| All retries exhausted | Telegram "needs human attention", mark `status: failed` |
| Orchestrator process crash | On restart, `TaskRegistry.getRunning()` resumes in-progress tasks |

---

## 11. Out of Scope (v1)

- No daemon / file watcher (Option B) — run manually
- No LLM-based task generation — you write the spec
- No Obsidian vault auto-sync — you specify context files explicitly
- No parallel task limit tuning via CLI flag (hardcoded to 3 concurrent)
- No web UI or dashboard

---

## 12. Connection to s01–s12 Study Material

| Study pattern | Where it appears |
|---|---|
| s01 Agent while-loop | Inside `RpcClient` (pi handles internally) |
| s03 TodoWrite | `TaskRegistry` file-based state |
| s04 Subagent isolation | Each `RpcClient` = isolated context window |
| s06 Context compression | `compact` RPC command during long runs |
| s07 Task dependency graph | `depends-on` resolution in `TaskScheduler` |
| s08 Background task lanes | `Promise.all()` across independent tasks |
| s09 Agent team mailboxes | RPC stdin/stdout is the mailbox |
| s10 FSM protocols | `pending → running → reviewing → done/failed` |
| s11 Autonomous cycle | Outer retry loop |
| s12 Worktree isolation | `WorktreeManager` — one worktree per task |
