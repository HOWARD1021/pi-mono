---
feature: Copilot EvalLoop Smoke Test
context: []
eval:
  type: track-a
  runner: code-coverage
  target: 85
  max-generations: 2
tasks:
  - id: task-hello-copilot
    title: "Add unit tests to improve coverage"
    model: gpt-4o
    runner: copilot
    max-retries: 2
    depends-on: []
---

## task-hello-copilot

You are working inside `packages/orchestrator/`.

**YOUR ONLY JOB:** Add unit tests that raise the overall statement coverage above **85%**.

### Steps

1. Run `bun run test --coverage` to see the current coverage report.
2. Find files with the lowest coverage in the `src/` summary.
3. Add new `.test.ts` files in `test/` that cover those gaps.
4. Re-run `bun run test --coverage` and confirm "All files" % improved.
5. Run `git add -A && git commit -m "test: add unit tests to improve coverage"`.

### Rules

- Only add test files — do NOT modify production `src/` files.
- Each test must exercise real logic (not just import the module).
- Focus on the lowest-hanging fruit: pure functions with simple inputs.
