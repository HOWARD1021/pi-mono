---
feature: Orchestrator Stress Test (DAG + Concurrency + Failure Retry)
context:
  - packages/orchestrator/src/types.ts
tasks:
  - id: task-create-math-lib
    title: "Step 1: Create a math utility"
    model: gpt-5-mini
    runner: copilot
    max-retries: 1
    depends-on: []

  - id: task-create-cli-consumer
    title: "Step 2: Create a consumer of the math utility"
    model: gpt-5-mini
    runner: copilot
    max-retries: 1
    depends-on: ["task-create-math-lib"]

  - id: task-intentional-failure
    title: "Step 3: Intentional Failure and Self-Correction"
    model: gpt-5-mini
    runner: copilot
    max-retries: 3
    depends-on: []
---

## task-create-math-lib

Create a new file `packages/orchestrator/src/math-utils.ts` with:
```typescript
export const add = (a: number, b: number): number => a + b;
```
This is a base task.

## task-create-cli-consumer

Create `packages/orchestrator/src/math-cli.ts`.
It MUST import `add` from `./math-utils.ts` (created in Step 1).
It should have a function `runCalc()` that calls `add(10, 20)`.

This task tests **dependency resolution** and **branch merging**.

## task-intentional-failure

1. Create `packages/orchestrator/src/buggy-validator.ts` with an `isEven(n: number)` function.
2. **DELIBERATE MISTAKE (Attempt 1):** Make the function always return `true` for any input.
3. Create a Vitest test file `packages/orchestrator/test/buggy-validator.test.ts` that imports `isEven` and asserts `isEven(3)` to be `false`.
4. The local CI (`bun run test`) will FAIL on Attempt 1 because `isEven(3)` will return `true`.
5. In **Attempt 2**, use the Failure Context (Gap B) to fix `isEven` to correctly return `n % 2 === 0`.

This tests **Failure Extraction**, **Context Propagation**, and **Worktree Resets**.
