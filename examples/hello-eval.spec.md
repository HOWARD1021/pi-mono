---
# EvalLoop Hello World
#
# This is the "Hello World" of the agent era:
#   AI generates code → scored automatically → keeps only improvements → loops until target
#
# Run:
#   bun packages/orchestrator/orchestrate.ts examples/hello-eval.spec.md

feature: Hello EvalLoop
eval:
  type: track-a
  runner: code-coverage
  target: 85
  max-generations: 3
tasks:
  - id: task-hello-eval
    title: "Improve test coverage to 85%"
    model: claude-opus-4-6
    runner: claude
---

## task-hello-eval

You are inside `packages/orchestrator/`.

**Goal:** Add unit tests until overall statement coverage exceeds **85%**.

Current baseline: ~83%. You need to add roughly 2–3 focused tests.

### What to do

1. Run `bun run test --coverage` — look at the "All files" row.
2. Pick the file with the lowest coverage (look at the `src/` breakdown).
3. Write one or two tests in `packages/orchestrator/test/` that cover real logic.
4. Run `bun run test --coverage` again to confirm improvement.
5. Commit: `git add -A && git commit -m "test: improve coverage for hello-eval"`

### What NOT to do

- Do not modify files in `src/` — tests only.
- Do not write trivial tests that just import a module without calling anything.
