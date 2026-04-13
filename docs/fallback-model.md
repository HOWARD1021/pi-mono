# Fallback Model / Runner on Retry

## What changed

When a task fails (code review catches a bug, local CI breaks, or cloud CI fails), the orchestrator retries with the same model by default. This often doesn't help — a weak model that writes broken code once will write it again.

**This feature lets a spec declare a smarter fallback model that activates automatically on attempt 2+.**

### Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Added `fallbackModel?: string` and `fallbackRunner?: "claude" \| "copilot"` to `ParsedTask` |
| `src/spec-parser.ts` | Added `fallback-model` and `fallback-runner` to `TaskFrontmatterSchema`; passed through in task mapping |
| `src/index.ts` | `runTaskWithRetry` resolves `activeModel` / `activeRunner` per attempt — uses fallback when attempt > 1 and fallback is declared |

### Core logic (index.ts)

```typescript
// attempt 1 → task.model / task.runner
// attempt 2+ (if fallback declared) → task.fallbackModel / task.fallbackRunner
const activeModel  = attempt > 1 && task.fallbackModel  ? task.fallbackModel  : task.model;
const activeRunner = attempt > 1 && task.fallbackRunner ? task.fallbackRunner : task.runner;
```

If no fallback is declared, retry behaviour is unchanged.

## How to use in a spec

```yaml
tasks:
  - id: task-write-tests
    title: "Write tests"
    model: gpt-5-mini          # attempt 1: fast + cheap
    runner: copilot
    fallback-model: claude-sonnet-4-6   # attempt 2+: smarter
    fallback-runner: claude
    max-retries: 2
    depends-on: ["task-build-core"]
```

- `fallback-model` and `fallback-runner` are both optional.
- You can set one without the other (e.g. keep the same runner but upgrade the model).
- Works with any `max-retries` value — every retry from attempt 2 onwards uses the fallback.

## Why this matters

The `client-demo.spec.md` was failing because `gpt-5-mini` (via copilot):
- Attempt 1: wrote code with prototype pollution / syntax errors → caught by code reviewer
- Attempt 2+: retried with the same weak model → same class of bugs

With fallback declared, a failed attempt hands off to `claude-sonnet-4-6` which can read the `attemptHistory` (the reviewer's CRITICAL comments are injected into the prompt) and fix the issue properly.
