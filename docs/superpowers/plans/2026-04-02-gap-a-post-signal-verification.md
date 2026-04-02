# Gap A — Post-Signal Verification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the agent outputs `<ready-for-review/>`, verify that the HEAD SHA actually changed — catching agents that signal completion without committing.

**Architecture:** `AgentRunner.run()` accepts a `baseSha` parameter. After detecting the completion signal, it reads the current HEAD SHA and rejects if it equals `baseSha`. `index.ts` passes `wt.baseCommitSha` into the call.

**Tech Stack:** TypeScript, Bun, Vitest, `node:child_process` (execSync)

---

## File Map

| File | Change |
|------|--------|
| `packages/orchestrator/src/agent-runner.ts` | Add `baseSha` param to `run()`, verify SHA changed |
| `packages/orchestrator/src/index.ts` | Pass `wt.baseCommitSha` to `agentRunner.run()` |
| `packages/orchestrator/test/agent-runner.integration.test.ts` | Add test: rejects when SHA unchanged |

---

## Task 1: Add SHA verification to AgentRunner

**Files:**
- Modify: `packages/orchestrator/src/agent-runner.ts`
- Test: `packages/orchestrator/test/agent-runner.integration.test.ts`

### Step 1: Write the failing test

Add this test to `test/agent-runner.integration.test.ts` inside the `describe("AgentRunner")` block:

```typescript
it("rejects when <ready-for-review/> appears but SHA did not change", async () => {
  // execSync always returns "base123" — same as baseSha
  vi.mocked(execSync).mockReturnValue(Buffer.from("base123\n"));
  vi.mocked(spawn).mockReturnValue(
    makeProc(["All done. <ready-for-review/>\n"]) as any
  );

  const runner = new AgentRunner("/wt/task-1");
  await expect(
    runner.run("Do the work", "claude-opus-4-6", 5000, "base123")
  ).rejects.toThrow(/no commit/i);
});
```

- [ ] Add the test above to `test/agent-runner.integration.test.ts`

### Step 2: Run test to verify it fails

```bash
cd packages/orchestrator && bun run test test/agent-runner.integration.test.ts
```

Expected: FAIL — `run()` does not accept 4th argument yet, or does not check SHA.

- [ ] Run and confirm failure

### Step 3: Modify `AgentRunner.run()` signature

In `packages/orchestrator/src/agent-runner.ts`, change the `run` signature and add SHA check:

**Before (line 9):**
```typescript
run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000): Promise<AgentResult> {
```

**After:**
```typescript
run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000, baseSha?: string): Promise<AgentResult> {
```

**Before (lines 31-39) — the completion block inside `proc.stdout.on("data")`:**
```typescript
if (!completed && text.includes(COMPLETION_SIGNAL)) {
  completed = true;
  clearTimeout(timer);
  proc.kill();
  resolve({
    summary: null,
    lastCommitSha: this.getHeadSha(),
  });
}
```

**After:**
```typescript
if (!completed && text.includes(COMPLETION_SIGNAL)) {
  completed = true;
  clearTimeout(timer);
  proc.kill();
  const newSha = this.getHeadSha();
  if (baseSha && newSha === baseSha) {
    reject(new Error(
      `Agent output <ready-for-review/> but made no commit (SHA unchanged: ${newSha})`
    ));
    return;
  }
  resolve({
    summary: null,
    lastCommitSha: newSha,
  });
}
```

- [ ] Apply the changes above to `agent-runner.ts`

### Step 4: Run test to verify it passes

```bash
cd packages/orchestrator && bun run test test/agent-runner.integration.test.ts
```

Expected: all 3 tests PASS (existing 2 + new 1).

- [ ] Run and confirm all pass

### Step 5: Commit

```bash
cd /Users/howard/learn-claude-agents
git add packages/orchestrator/src/agent-runner.ts packages/orchestrator/test/agent-runner.integration.test.ts
git commit -m "feat(orchestrator): Gap A — verify SHA changed after ready-for-review signal"
```

- [ ] Commit

---

## Task 2: Wire baseSha into index.ts

**Files:**
- Modify: `packages/orchestrator/src/index.ts:85-86`
- Test: `packages/orchestrator/test/index.test.ts`

### Step 1: Write the failing test

In `test/index.test.ts`, add a second test inside `describe("runTaskWithRetry")`:

```typescript
it("fails when agent signals ready but SHA unchanged (Gap A)", async () => {
  // Override AgentRunner mock to reject with no-commit error
  const { AgentRunner } = await import("../src/agent-runner.js");
  vi.mocked(AgentRunner).mockImplementationOnce(() => ({
    run: vi.fn().mockRejectedValue(
      new Error("Agent output <ready-for-review/> but made no commit (SHA unchanged: base123)")
    ),
  }));

  const result = await runTaskWithRetry(mockTask, [], "main");
  expect(result.success).toBe(false);
  expect(result.failureReason).toMatch(/attempts failed/i);
});
```

- [ ] Add the test above to `test/index.test.ts`

### Step 2: Run test to verify it fails

```bash
cd packages/orchestrator && bun run test test/index.test.ts
```

Expected: FAIL — `index.ts` doesn't pass `baseSha` yet, so the real AgentRunner mock isn't triggered.

- [ ] Run and confirm failure

### Step 3: Pass baseSha in index.ts

In `packages/orchestrator/src/index.ts`, find line ~86:

**Before:**
```typescript
const agentResult = await agentRunner.run(prompt, task.model);
```

**After:**
```typescript
const agentResult = await agentRunner.run(prompt, task.model, undefined, wt.baseCommitSha);
```

- [ ] Apply the change to `index.ts`

### Step 4: Run all tests

```bash
cd packages/orchestrator && bun run test
```

Expected: **38+ pass, 1 skipped** (same as before, plus new tests).

- [ ] Run and confirm full suite passes

### Step 5: Commit

```bash
cd /Users/howard/learn-claude-agents
git add packages/orchestrator/src/index.ts packages/orchestrator/test/index.test.ts
git commit -m "feat(orchestrator): Gap A — wire baseSha from worktree into AgentRunner"
```

- [ ] Commit

---

## Verification

After both tasks:

```bash
cd packages/orchestrator && bun run test
# Expected: all tests pass (at least 40 pass, 1 skipped)

git log --oneline -3
# Expected: two new commits on top
```

Gap A is done when:
- `AgentRunner.run()` accepts `baseSha` and rejects if SHA unchanged
- `index.ts` passes `wt.baseCommitSha` into every `agentRunner.run()` call
- All existing tests still pass
