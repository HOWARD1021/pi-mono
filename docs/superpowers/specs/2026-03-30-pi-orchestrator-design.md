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
Before finishing:
1. Run `bun test && tsc --noEmit` — all checks must pass
2. Run `git add -A && git commit -m "feat: [short description]"`
Only output <ready-for-review/> AFTER committing AND all local checks pass.
Do NOT output this signal until both conditions are true.

## Previous attempt failures (if any)
${attemptHistory}
```

The agent runs its own fix → test → commit → fix loop. Before outputting `<ready-for-review/>` the agent must have committed all changes to the branch (the prompt explicitly requires a final `git commit`). The orchestrator listens to `AgentEvent` objects from `RpcClient.onEvent()`, scanning assistant `TextContent` blocks for the signal. No polling needed.

### Outer Loop — Autoresearch Pattern (orchestrator keeps/discards)

```
for attempt 1..maxRetries:
  run inner loop → wait for <ready-for-review/>
  // Agent has committed all changes before signaling
  gh pr create --fill   (or gh pr edit if PR already exists from prior attempt)
  // PR now exists with at least one commit — cloud CI can run
  gh pr checks --watch   ← cloud CI = "the metric"

  if CI passes:
    run four-reviewer review (Codex + Copilot + Gemini + Claude Sonnet)
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
- Checks all `context` file paths exist — if missing, throws at parse time (fail-fast)
- Note: `ContextLoader` can therefore assume all paths are valid

### ContextLoader
- Input: array of validated file paths
- Output: concatenated markdown string, truncated to ~4k tokens each
- Reads from the markdown vault directory
- No defensive file-existence check needed (SpecParser owns that)

### TaskRegistry
- File: `.clawdbot/active-tasks.json`
- Schema: `{ [taskId]: TaskRecord }`
- Atomic writes (write to `.tmp`, rename)
- `getRunning()` — on orchestrator restart, tasks marked `running` are treated as failed attempts and re-entered into the outer loop at attempt N+1 (no RpcClient reconnect possible — each attempt spawns a fresh subprocess)

### TaskScheduler
- Reads `ParsedSpec.tasks`, builds dependency graph from `depends-on`
- Runs independent tasks concurrently (hardcoded max 3 parallel tasks via semaphore)
- Waits for a task's dependency to reach `status: done` before starting the dependent task

### WorktreeManager
- `create(taskId, branch, baseBranch)` → `git worktree add -b branch path baseBranch`, returns path
- `remove(taskId)` → `git worktree remove path`
- `create()` captures and stores the resolved base commit SHA at creation time: `git rev-parse baseBranch` → stored in `TaskRecord.baseCommitSha`
- `reset(worktreePath, baseCommitSha)` → `git reset --hard <baseCommitSha>` + `git push --force-with-lease` — discards all commits the agent made, restoring the branch to exactly the state when the worktree was created, regardless of any subsequent advancement of the base branch. Each retry starts from a clean branch.

### AgentRunner
- Constructs a **new `RpcClient` per attempt** — `cwd` is set at construction time (`RpcClientOptions.cwd = worktreePath`), not per-call
- Lifecycle per attempt: `client.start()` → `client.prompt(prompt)` → listen to events → `client.stop()`
- **Completion detection:** listens to `AgentEvent` stream; on `message_end` events where `message.role === "assistant"`, scans `content` array for `TextContent` blocks containing `<ready-for-review/>`. Resolves the run promise when found. Falls back to timeout (30min) if signal never appears.
- Agent is expected to have committed all changes before outputting `<ready-for-review/>`. The inner loop prompt explicitly instructs this (see Section 5).
- Returns `AgentResult { summary, gitLog, lastCommitSha }`

### CIRunner
- `runLocal(worktreePath)` → `bun test && tsc --noEmit` in the worktree directory
- `runCloud(branch)` → `gh pr checks --watch --interval 30`
- Returns `CIResult { passed, failedChecks, runId, errorOutput }`
- PR must exist before `runCloud` is called — `CIRunner` does not create PRs

### FailureExtractor
- Uses a small/fast model (resolve via `getAvailableModels()` at startup — use whatever the current haiku-tier model ID is; do not hardcode)
- Input: CI error output (truncated to 3k tokens)
- Output: `{ summary: string, failedTests: string[], approach: string }`
- Used to build the next attempt's `attemptHistory` injection

### ReviewOrchestrator
- Spawns 4 `RpcClient` instances in `Promise.all()` — no worktree needed (read-only review)
- Codex: edge cases, race conditions, logic errors
- Copilot: GitHub-native context, repo conventions (requires GitHub OAuth token via `getApiKey` callback — read from `GITHUB_TOKEN` env var)
- Gemini: security, accessibility (requires `GEMINI_API_KEY` env var)
- Claude Sonnet: validation, flags critical issues only (requires `ANTHROPIC_API_KEY` env var)
- Each agent posts review comments directly via `gh pr review` tool call
- Returns `ReviewResult { passed, criticalIssues[] }`

### PromptBuilder
- `build(task, contextChunks, attemptHistory, gitLog)` → `string`
- Constructs the inner-loop prompt with: task description, context chunks, git history on the branch, previous attempt failures, and explicit local completion gate instructions
- The `attemptHistory` injection is where the autoresearch intelligence lives — structured failure context from `FailureExtractor` tells the agent exactly what went wrong and why a different approach is needed
- On attempt 1: `attemptHistory` is empty
- On attempt N: injects all prior `FailureExtractor` outputs as labeled sections

### Notifier
- Telegram Bot API (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` env vars)
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
interface DefinitionOfDone {
  prCreated: boolean;
  localCIPassed: boolean;
  cloudCIPassed: boolean;
  codexReviewPassed: boolean;
  copilotReviewPassed: boolean;
  geminiReviewPassed: boolean;
  claudeReviewPassed: boolean;
  screenshotsIncluded: boolean; // only checked if task.requiresScreenshots === true
}

interface TaskRecord {
  id: string;
  branch: string;
  worktree: string;
  baseCommitSha: string;         // captured at worktree creation; used for clean resets
  status: "pending" | "running" | "done" | "failed" | "waiting_review";
  attempts: number;
  maxRetries: number;
  attemptHistory: string[];      // FailureExtractor output per failed attempt
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
| Context file missing | `SpecParser` throws `SpecValidationError`, exit 1 — fail-fast before any agent spawns |
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
