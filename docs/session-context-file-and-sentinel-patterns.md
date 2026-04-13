# Session Tutorial: Context File + Structured Sentinel Patterns

> **Session date:** 2026-04-13
> **Study stage:** s04 (Subagent) / s11 (Error Recovery) territory
> **Time to read:** ~10 min

---

## 1. What We Did (本次做了什麼)

We compared two architectures for communicating between an orchestrator and a spawned agent CLI, then borrowed two patterns from `codex-delegate` and wired them into Pi Orchestrator's `AgentRunner`.

| Pattern | Borrowed from | Wired into |
|---|---|---|
| **Context File** | `run_codex.sh` lines 84–85 | `agent-runner.ts` lines 24–31 |
| **Structured Sentinel Files** | `run_codex.sh` lines 105–108, 122 | `agent-runner.ts` lines 58–59, 81–93, 118–120 |

Neither pattern replaces the streaming `<ready-for-review/>` signal — they add a richer data layer around it: one for task input, one for task outcome.

---

## 2. Where This Fits in s01–s12 (框架定位)

| Session | Concept | This session's connection |
|---|---|---|
| **s04** Subagent | Parent passes a prompt to a child agent | The context file IS that prompt boundary, now on disk |
| **s11** Error Recovery | Classify failure before routing | Sentinel content (`TIMEOUT\|`, `HARD_FAIL\|`, `DONE\|`) = classify-first, written to disk |
| **s12** Worktree | Durable per-task state survives compression | `.agent-done` / `.agent-error` are single-task versions of the task graph |

**Key insight (bilingual):**

> The streaming signal says "done."
> The sentinel files say "done, why, when, and with what SHA."
>
> 串流訊號說「結束了」；sentinel 檔說「原因、時間、哪個 commit」。

---

## 3. Pattern 1 — Context File (上下文檔案模式)

### The problem

Passing a multi-paragraph task prompt inline as `-p "<prompt>"` has three failure modes:

1. **Shell quoting breaks** on newlines, backticks, or special characters
2. **Invisible after the fact** — the prompt lives only in process memory, gone when it exits
3. **Lost on crash** — if the agent dies mid-stream, you have no record of what it was asked to do

### Where the idea came from

`/tmp/codex-delegate/scripts/run_codex.sh` lines 84–85:

```bash
PROMPT_FILE="$(mktemp /tmp/codex_prompt_XXXXXX.txt)"
printf '%s' "$PROMPT" > "$PROMPT_FILE"
CODEX_ARGS+=("$(cat "$PROMPT_FILE")")   # ← read from file, not inline
rm -f "$PROMPT_FILE"
```

codex-delegate writes the prompt to a temp file, reads it back as the CLI argument. The key insight: **decouple the prompt from the shell argument**.

We went further — keep the file in the worktree (not `/tmp`) so it persists as an audit trail.

### Before (conceptual)

```typescript
// Full 200-line prompt passed inline — fragile, invisible, lossy
const [cmd, args] = this.buildSpawnArgs(prompt, model, logDir);
spawn(cmd, args, { cwd: this.worktreePath });
```

### After — `agent-runner.ts` lines 24–36

```typescript
// Context file pattern (borrowed from codex-delegate):
// Write full prompt to disk so it survives crashes and leaves an audit trail.
// Pass a short reference prompt to the CLI instead of the full inline string.
const contextDir = join(this.worktreePath, ".agent-context");
mkdirSync(contextDir, { recursive: true });
const contextFile = join(contextDir, "task.md");
writeFileSync(contextFile, prompt, "utf8");
const refPrompt = "Read .agent-context/task.md and execute all instructions inside.";

// Clean up stale sentinel files from previous runs
for (const f of [".agent-done", ".agent-error", ".agent-fallback"]) {
    try { require("node:fs").rmSync(join(this.worktreePath, f)); } catch { /* not present */ }
}

// ...later...
const [cmd, args] = this.buildSpawnArgs(refPrompt, model, logDir);
//                                       ^^^^^^^^^ always the same 8 words
```

### What this buys

- The prompt is now a **Markdown file inside the worktree** — readable by any tool, version-controllable, crash-survivable
- The CLI argument is always the same short sentence regardless of task complexity
- The context file can be inspected after a failure to understand what the agent was asked

### The test contract

`agent-runner.integration.test.ts` lines 52–61 now verifies **both sides**:

```typescript
const REF_PROMPT = "Read .agent-context/task.md and execute all instructions inside.";

// Side 1: original prompt written to disk
expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
    "/wt/task-1/.agent-context/task.md",
    "Do the work",   // ← original prompt
    "utf8",
);

// Side 2: reference prompt passed to CLI
expect(spawn).toHaveBeenCalledWith(
    "claude",
    expect.arrayContaining(["-p", REF_PROMPT]),  // ← not the original prompt
    expect.objectContaining({ cwd: "/wt/task-1" }),
);
```

---

## 4. Pattern 2 — Structured Sentinel Files (結構化哨兵檔案模式)

### The problem

Before this change, every failure was a rejected Promise — no durable record on disk:

```typescript
reject(new Error("Agent timeout: <ready-for-review/> never appeared after 1800000ms"));
// ← gone when the Promise chain unwinds
```

If you wanted to know *why* a task failed after the fact, you had to read logs. Logs are verbose. Sentinel files are concise and machine-readable.

### Where the idea came from

`/tmp/codex-delegate/scripts/run_codex.sh` lines 105–108, 122:

```bash
# Format: REASON|detail|ISO-8601-timestamp
echo "ALL_QUOTA_EXCEEDED|$(date -u +%Y-%m-%dT%H:%M:%SZ)"  > "$ERROR_PATH"
echo "FALLBACK_TO_CLAUDE|$(date -u +%Y-%m-%dT%H:%M:%SZ)"  > "$FALLBACK_PATH"
echo "DONE|codex/$MODEL|$(date -u +%Y-%m-%dT%H:%M:%SZ)"   > "$DONE_PATH"
```

The `|`-delimited format makes the content trivially parseable by `split("|")`.

### The four outcome points

Every call to `AgentRunner.run()` now ends in exactly one of these:

| File | Content format | `agent-runner.ts` line | Meaning |
|---|---|---|---|
| `.agent-done` | `DONE\|model\|sha\|ts` | 88–93 | Clean success, SHA verified |
| `.agent-error` | `HARD_FAIL\|no-commit\|ts` | 81–85 | Signal sent, no git commit (lie caught) |
| `.agent-error` | `TIMEOUT\|Nms\|ts` | 58–59 | Hit the wall-clock timeout |
| `.agent-error` | `HARD_FAIL\|exit N\|ts` | 118–120 | Process exited without signalling |

### Code for each outcome

**Timeout** (`agent-runner.ts` line 58–59):
```typescript
const msg = `TIMEOUT|${timeoutMs}ms|${new Date().toISOString()}`;
writeFileSync(join(this.worktreePath, ".agent-error"), msg, "utf8");
```

**Lie caught — signal with no commit** (lines 81–85):
```typescript
writeFileSync(
    join(this.worktreePath, ".agent-error"),
    `HARD_FAIL|no-commit|${new Date().toISOString()}`,
    "utf8",
);
```

**Clean success** (lines 88–93):
```typescript
writeFileSync(
    join(this.worktreePath, ".agent-done"),
    `DONE|${model}|${newSha}|${new Date().toISOString()}`,
    "utf8",
);
```

**Hard crash — process exited without signalling** (lines 118–120):
```typescript
writeFileSync(
    join(this.worktreePath, ".agent-error"),
    `HARD_FAIL|exit ${code}|${new Date().toISOString()}`,
    "utf8",
);
```

### s11 connection

s11 teaches: **classify failure before routing it.** The sentinel format externalises that classification to disk. Any downstream consumer — another agent, a monitoring script, a test — can read `.agent-error`, split on `|`, and branch on `TIMEOUT` vs `HARD_FAIL` without reimplementing the classification logic.

---

## 5. Head-to-Head Test Results

File: `packages/orchestrator/test/approach-comparison.test.ts`

We built a `SentinelAgentRunner` that mimics codex-delegate (writes `.done` file, no SHA check) and ran the same three scenarios against both implementations.

| Scenario | Winner | Why |
|---|---|---|
| Lie detection | **Streaming** | SHA check catches agent claiming done with no commit |
| Parallelism (4 agents) | **Streaming** | `Promise.all` — all 4 finish in ~50ms, not 4×50ms |
| Crash error classification | **Sentinel** | `.error` file carries structured reason; streaming gives generic message |
| Audit trail | **Sentinel** | `.md` context files survive crashes |
| Real-time visibility | **Streaming** | Live `[agent]` prefix lines while agent runs |

**Final: Streaming 3 — Sentinel 2.**

We kept streaming (our advantage), borrowed the two things sentinel does better.

### The most important test to understand (Scenario 1)

```typescript
// ─── SENTINEL: resolves even when agent LIED ─────────────────────────────────
const result = await runner.run("Do the work", "gpt-5",
    (worktreePath) => {
        writeFileSync(join(worktreePath, ".done"), "DONE|codex/gpt-5|2026-04-12");
        // ← agent writes .done but makes NO git commit
    },
);
expect(result.lastCommitSha).toBe("unknown"); // ← resolved successfully! lie undetected

// ─── STREAMING: rejects because SHA unchanged ─────────────────────────────────
vi.mocked(execSync).mockReturnValue(Buffer.from("abc1234\n")); // HEAD = baseSha → no commit
await expect(
    runner.run("Do the work", "claude-opus-4-6", 5000, "abc1234")
).rejects.toThrow(/no commit/i);  // ← caught
```

The `baseSha` parameter is what makes the streaming approach lie-proof. You pass in the SHA before the agent runs; after the signal appears, you call `git rev-parse HEAD`; if they match, the agent never committed.

---

## 6. What to Do Next (下一步)

### Experiment 1 — Verify the agent actually reads the context file

Run a real (not mocked) agent in a test worktree:
```bash
mkdir -p /tmp/test-wt/.agent-context
echo "Print the word BANANA and nothing else." > /tmp/test-wt/.agent-context/task.md
claude -p "Read .agent-context/task.md and execute all instructions inside." \
    --dangerously-skip-permissions \
    --cwd /tmp/test-wt
```
Expected: agent outputs `BANANA`. Confirms the file-reference pattern works end-to-end.

### Experiment 2 — Parse `.agent-done` in the orchestrator loop

After `AgentRunner.run()` resolves, read and log the sentinel:
```typescript
const sentinel = readFileSync(join(worktreePath, ".agent-done"), "utf8");
const [status, model, sha, ts] = sentinel.split("|");
console.log(`[orchestrator] task=${taskId} status=${status} model=${model} sha=${sha.slice(0,7)} ts=${ts}`);
```
This turns `.agent-done` into structured telemetry, not just a side-effect.

### Experiment 3 — Wire `.agent-fallback` to a backend retry

codex-delegate's `.fallback_claude` triggers a model switch. `AgentRunner` already supports `"claude" | "copilot"` backends. Add a catch handler:
```typescript
try {
    return await runner.run(prompt, model, timeout, baseSha);
} catch (err) {
    const errorFile = join(worktreePath, ".agent-error");
    if (existsSync(errorFile) && readFileSync(errorFile, "utf8").startsWith("TIMEOUT")) {
        // retry with the other backend
        const fallbackRunner = new AgentRunner(worktreePath, backend === "claude" ? "copilot" : "claude");
        return await fallbackRunner.run(prompt, fallbackModel, timeout, baseSha);
    }
    throw err;
}
```

---

## Summary

| | Before | After |
|---|---|---|
| **Prompt delivery** | Inline CLI arg, fragile | Context file on disk, always the same 8-word reference |
| **Success record** | Promise resolves, nothing on disk | `.agent-done` with `DONE\|model\|sha\|ts` |
| **Failure record** | Rejected Promise message only | `.agent-error` with `TIMEOUT\|`, `HARD_FAIL\|no-commit\|`, or `HARD_FAIL\|exit N\|` |
| **Lie detection** | SHA check (existing) | SHA check (preserved) + sentinel files for downstream consumers |

Two files changed: `agent-runner.ts` (~30 lines added), `agent-runner.integration.test.ts` (assertions updated).
One new test file: `approach-comparison.test.ts` (11 tests, 3 scenarios, scorecard).
