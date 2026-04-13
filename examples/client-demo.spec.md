---
# Client Demo Spec
#
# Story: Three AI agents collaborate to build a word-frequency analyzer from scratch.
#
#   Agent 1 — builds the core library (fast text analysis)
#   Agent 2 — writes tests (depends on Agent 1)
#   Agent 3 — optimizes speed in a loop until 10x faster (EvalLoop, depends on Agent 2)
#
# What the client sees:
#   - Three agents working in parallel/sequence without human intervention
#   - Agent 3 tries, fails, self-corrects, and improves — tracked in a score chart
#   - Final result: a working, tested, optimized library — built entirely by AI
#
# Run:
#   bun packages/orchestrator/orchestrate.ts examples/client-demo.spec.md

feature: "AI Team: Build & Optimize a Word Frequency Analyzer"
context:
  - ../packages/orchestrator/src/types.ts
tasks:
  - id: task-build-core
    title: "Agent 1: Build the core library"
    model: gpt-5-mini
    runner: copilot
    fallback-model: claude-sonnet-4-6
    fallback-runner: claude
    max-retries: 2
    depends-on: []

  - id: task-write-tests
    title: "Agent 2: Write tests for the library"
    model: gpt-5-mini
    runner: copilot
    fallback-model: claude-sonnet-4-6
    fallback-runner: claude
    max-retries: 2
    depends-on: ["task-build-core"]

  - id: task-optimize
    title: "Agent 3: Optimize until 10x faster (EvalLoop)"
    model: gpt-5-mini
    runner: copilot
    fallback-model: claude-sonnet-4-6
    fallback-runner: claude
    max-retries: 3
    depends-on: ["task-write-tests"]
---

## task-build-core

Create `packages/orchestrator/src/word-freq.ts` with a word frequency analyzer.

```typescript
// Required exports — implement them:

/** Count word frequencies in a string. Case-insensitive. */
export function wordFrequency(text: string): Map<string, number>

/** Return the top-N most frequent words, sorted descending. */
export function topWords(text: string, n: number): Array<{ word: string; count: number }>

/** Return total word count (excluding punctuation). */
export function wordCount(text: string): number
```

### Requirements

- Strip punctuation before counting (`,.!?;:"'()-`)
- Case-insensitive (`Hello` and `hello` are the same word)
- Ignore empty strings and single-character tokens
- All functions must be exported

Do NOT write tests here. Tests are Agent 2's job.

---

## task-write-tests

Agent 1 has already created `packages/orchestrator/src/word-freq.ts`.

Create `packages/orchestrator/test/word-freq.test.ts` with Vitest tests that:

1. Test `wordFrequency` with a known sentence and assert specific counts
2. Test `topWords` returns results sorted by frequency descending
3. Test `wordCount` correctly counts words and ignores punctuation
4. Test edge cases: empty string, single word, repeated punctuation

Run `bun run test` from `packages/orchestrator/` to confirm all tests pass before committing.

---

## task-optimize

Agents 1 and 2 have built and tested `word-freq.ts`.

**Your job:** Make `wordFrequency` as fast as possible.

### Baseline measurement

Run this benchmark before making any changes and record the time:

```typescript
// packages/orchestrator/benchmark/word-freq.bench.ts
import { wordFrequency } from "../src/word-freq.js";

const LARGE_TEXT = "the quick brown fox ".repeat(50_000); // 200k words

console.time("wordFrequency");
for (let i = 0; i < 10; i++) {
  wordFrequency(LARGE_TEXT);
}
console.timeEnd("wordFrequency");
```

Run: `bun run packages/orchestrator/benchmark/word-freq.bench.ts`

### Goal

Get the average time per call below **50ms** on the 200k-word input.

### Optimization strategies to consider

- Replace regex with character-by-character parsing
- Use `Object` instead of `Map` for faster key lookups
- Pre-allocate result structures
- Reduce allocations in the hot path

**The EvalLoop will score you on execution time. Each generation you will see your score vs the best so far. Beat it.**

After each optimization attempt:
1. Confirm all tests still pass: `bun run test`
2. Re-run the benchmark and record the new time
3. Commit: `git add -A && git commit -m "perf: optimize wordFrequency — <Xms>"`
