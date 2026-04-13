---
# eval-workflow-coverage.spec.md
#
# A more demanding eval spec that:
#   1. Targets 92% (hard — requires 2-3 generations, so we actually see the
#      discard-on-regression and new-best cycles that make EvalLoop interesting)
#   2. Focuses the agent on the three newest, lowest-coverage files so the
#      agent has clear direction instead of hunting for low-hanging fruit
#   3. Uses sonnet-4-6 for faster iteration (cheaper per generation)
#
# Run:
#   bun packages/orchestrator/orchestrate.ts examples/eval-workflow-coverage.spec.md

feature: EvalLoop Workflow Coverage
eval:
  type: track-a
  runner: code-coverage
  target: 92
  max-generations: 5
tasks:
  - id: task-eval-coverage
    title: "Reach 92% coverage — focus on eval-loop, eval-runner, score-registry"
    model: gpt-5-mini
    runner: copilot
    max-retries: 2
---

## task-eval-coverage

You are inside `packages/orchestrator/`.

**Goal:** Push the "All files" statement coverage to **≥ 92%**.

---

### Step 1 — Measure first

```bash
bun run test --coverage 2>&1 | grep -E "All files|eval-loop|eval-runner|score-registry"
```

Look at the three target files:

| File | What it does | What to test |
|------|-------------|-------------|
| `src/eval-loop.ts` | Runs generation loop: best-keep / discard / stop-at-target | Happy path (target reached gen 1), regression drop (gen 2 worse → reset), max-gens exhausted |
| `src/eval-runner.ts` | Parses `bun run test --coverage` output → score | Coverage line found, coverage line missing, test suite crashes (score = 0) |
| `src/score-registry.ts` | Appends ScoreEntry to `.clawdbot/scores.json` | First write (creates file), second write (appends), `getHistory` returns entries in order |

---

### Step 2 — Write focused tests

Add files in `test/`. Name them clearly:

- `test/eval-runner.unit.test.ts` — unit tests for `CodeEvalRunner.run()`
- `test/score-registry.unit.test.ts` — unit tests for `ScoreRegistry`
- `test/eval-loop.unit.test.ts` — unit tests for `EvalLoop.run()` with mocked `AgentRunner` + `EvalRunner`

**Rules for `eval-loop` tests** — the loop depends on `AgentRunner` and `WorktreeManager`.
Mock them using Bun's `mock()`:

```ts
import { mock } from "bun:test";

// Stub WorktreeManager so no real git ops run
mock.module("../src/worktree-manager.js", () => ({
  WorktreeManager: class {
    create() { return { path: "/tmp/wt", baseCommitSha: "base-sha" }; }
    reset() {}
    remove() {}
  },
}));

// Stub AgentRunner to resolve instantly
mock.module("../src/agent-runner.js", () => ({
  AgentRunner: class {
    async run() { return { summary: null, lastCommitSha: "new-sha" }; }
  },
}));
```

Then test the loop logic:
- `target reached in gen 1` → `reachedTarget: true`, `generations: 1`
- `gen 1 score < target, gen 2 score >= target` → `generations: 2`, best = gen 2 score
- `all generations below target` → `reachedTarget: false`, best = highest of all gens
- `gen 2 regresses below gen 1` → `kept: false` for gen 2, `bestScore` unchanged

---

### Step 3 — Verify and commit

```bash
bun run test --coverage 2>&1 | grep "All files"
```

If "All files" is ≥ 92, commit:

```bash
git add -A && git commit -m "test: eval-loop/eval-runner/score-registry unit tests (92% coverage)"
```

If < 92, find the remaining gap in the per-file breakdown and add one more test.

---

### What NOT to do

- Do **not** modify any file in `src/` — tests only.
- Do **not** write empty tests that just `import` a module.
- Do **not** write tests that depend on a real git repo being present — mock `WorktreeManager`.
