# Pi Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `bun orchestrate spec.md` — a standalone CLI that reads a YAML+markdown spec, spawns Pi Agent workers in git worktrees, validates via CI, retries on failure with injected failure context, runs four parallel AI reviewers, and sends Telegram notifications when PRs are ready.

**Architecture:** Two-loop design inspired by Ralph Wiggum (inner: agent self-certifies via `<ready-for-review/>`) and Karpathy autoresearch (outer: orchestrator keeps/discards per CI metric). `RpcClient` from `@mariozechner/pi-coding-agent` replaces tmux. One `RpcClient` subprocess per attempt, pinned to its git worktree via `cwd` at construction time.

**Tech Stack:** TypeScript (ES modules), Vitest, Zod, `@mariozechner/pi-coding-agent` (RpcClient), `yaml` npm package, `gh` CLI, `git` CLI, Telegram Bot API

---

## File Map

```
packages/orchestrator/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── orchestrate.ts                  ← CLI entry point
├── src/
│   ├── types.ts                    ← All shared interfaces (TaskRecord, ParsedSpec, etc.)
│   ├── spec-parser.ts              ← YAML frontmatter parsing + Zod validation
│   ├── context-loader.ts           ← Reads vault markdown files, trims to token budget
│   ├── task-registry.ts            ← .clawdbot/active-tasks.json atomic R/W
│   ├── worktree-manager.ts         ← git worktree add/reset/remove
│   ├── prompt-builder.ts           ← Builds agent prompts with context + failure history
│   ├── agent-runner.ts             ← RpcClient wrapper, detects <ready-for-review/>
│   ├── ci-runner.ts                ← bun test + gh pr checks
│   ├── failure-extractor.ts        ← Uses small LLM to extract failure context
│   ├── review-orchestrator.ts      ← 4 parallel RpcClient reviewers
│   ├── task-scheduler.ts           ← Dependency graph + concurrency semaphore
│   └── notifier.ts                 ← Telegram Bot API
└── test/
    ├── spec-parser.test.ts
    ├── context-loader.test.ts
    ├── task-registry.test.ts
    ├── worktree-manager.test.ts
    ├── prompt-builder.test.ts
    ├── agent-runner.integration.test.ts
    ├── ci-runner.integration.test.ts
    ├── task-scheduler.test.ts
    ├── smoke.e2e.test.ts
    └── fixtures/
        ├── simple-spec.md
        ├── multi-task-spec.md
        └── invalid-spec.md
```

---

## Chunk 1: Package Scaffold + Types + SpecParser

### Task 1: Scaffold the package

**Files:**
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/tsconfig.json`
- Create: `packages/orchestrator/tsconfig.build.json`
- Create: `packages/orchestrator/vitest.config.ts`
- Modify: `package.json` (root) — add `packages/orchestrator` to workspaces

- [ ] **Step 1: Create package.json**

```json
// packages/orchestrator/package.json
{
  "name": "@mariozechner/pi-orchestrator",
  "version": "0.1.0",
  "description": "Spec-driven autonomous dev workflow orchestrator",
  "type": "module",
  "bin": {
    "orchestrate": "dist/orchestrate.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "clean": "shx rm -rf dist",
    "build": "tsgo -p tsconfig.build.json",
    "dev": "tsgo -p tsconfig.build.json --watch --preserveWatchOutput",
    "test": "vitest --run"
  },
  "dependencies": {
    "@mariozechner/pi-agent-core": "^0.57.1",
    "@mariozechner/pi-coding-agent": "^0.57.1",
    "@mariozechner/pi-ai": "^0.57.1",
    "yaml": "^2.8.2",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^24.3.0",
    "shx": "^0.4.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// packages/orchestrator/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "paths": {}
  },
  "include": ["src/**/*", "orchestrate.ts", "test/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

```json
// packages/orchestrator/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*", "orchestrate.ts"],
  "exclude": ["dist", "node_modules", "test"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
// packages/orchestrator/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Expose `RpcClient` from coding-agent package**

`RpcClient` lives in `@mariozechner/pi-coding-agent/modes` but the package's `exports` map only exposes `.` and `./hooks`. Add a `"./modes"` entry to `packages/coding-agent/package.json`:

```json
// In packages/coding-agent/package.json, add to "exports":
"./modes": {
  "types": "./dist/modes/index.d.ts",
  "import": "./dist/modes/index.js"
}
```

This lets orchestrator import via:
```typescript
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
```

- [ ] **Step 6: Add to root workspaces**

In root `package.json`, add `"packages/orchestrator"` to the `"workspaces"` array.

- [ ] **Step 7: Install deps**

```bash
cd /Users/howard/learn-claude-agents
bun install
```

Expected: no errors, `packages/orchestrator/node_modules` created.

- [ ] **Step 8: Commit scaffold**

```bash
git add packages/orchestrator/package.json packages/orchestrator/tsconfig*.json packages/orchestrator/vitest.config.ts packages/coding-agent/package.json package.json package-lock.json
git commit -m "feat(orchestrator): scaffold package + expose RpcClient from coding-agent exports"
```

---

### Task 2: Define shared types

**Files:**
- Create: `packages/orchestrator/src/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
// packages/orchestrator/src/types.ts

export interface ParsedTask {
  id: string;
  title: string;
  model: string;           // default: "claude-opus-4-6"
  maxRetries: number;      // default: 3
  requiresScreenshots: boolean; // default: false
  dependsOn: string[];     // task IDs that must complete first
  description: string;     // free-form markdown body
}

export interface ParsedSpec {
  feature: string;
  contextFiles: string[];  // absolute paths, pre-validated
  tasks: ParsedTask[];
}

export interface DefinitionOfDone {
  prCreated: boolean;
  localCIPassed: boolean;
  cloudCIPassed: boolean;
  codexReviewPassed: boolean;
  copilotReviewPassed: boolean;
  geminiReviewPassed: boolean;
  claudeReviewPassed: boolean;
  screenshotsIncluded: boolean;
}

export type TaskStatus = "pending" | "running" | "done" | "failed" | "waiting_review";

export interface TaskRecord {
  id: string;
  branch: string;
  worktree: string;
  baseCommitSha: string;       // captured at worktree creation for clean resets
  status: TaskStatus;
  attempts: number;
  maxRetries: number;
  attemptHistory: string[];    // failure context per attempt
  pr?: number;
  prUrl?: string;
  checks?: DefinitionOfDone;
  startedAt: number;
  completedAt?: number;
  model: string;
}

export interface CIResult {
  passed: boolean;
  failedChecks: string[];
  runId?: string;
  errorOutput: string;
}

export interface FailureContext {
  summary: string;
  failedTests: string[];
  approach: string;
}

export interface AgentResult {
  summary: string | null;
  lastCommitSha: string;
}

export interface ReviewResult {
  passed: boolean;
  criticalIssues: string[];
}

export interface TaskRunResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  failureReason?: string;
  attemptHistory: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/types.ts
git commit -m "feat(orchestrator): add shared types"
```

---

### Task 3: SpecParser — write tests first

**Files:**
- Create: `packages/orchestrator/test/fixtures/simple-spec.md`
- Create: `packages/orchestrator/test/fixtures/multi-task-spec.md`
- Create: `packages/orchestrator/test/fixtures/invalid-spec.md`
- Create: `packages/orchestrator/test/spec-parser.test.ts`
- Create: `packages/orchestrator/src/spec-parser.ts`

- [ ] **Step 1: Create test fixtures**

```markdown
<!-- packages/orchestrator/test/fixtures/simple-spec.md -->
---
feature: Smoke Test Feature
context: []
tasks:
  - id: task-1
    title: Add a comment
---

## task-1

Add a comment `/* ORCHESTRATOR_TEST */` to src/index.ts.
Commit and output <ready-for-review/>.
```

```markdown
<!-- packages/orchestrator/test/fixtures/multi-task-spec.md -->
---
feature: Multi Task Feature
context: []
tasks:
  - id: task-1
    title: Backend API
    model: claude-opus-4-6
    max-retries: 2
    requires-screenshots: false

  - id: task-2
    title: Frontend UI
    depends-on: [task-1]
    requires-screenshots: true
---

## task-1

Build the backend.

## task-2

Build the frontend.
```

```markdown
<!-- packages/orchestrator/test/fixtures/invalid-spec.md -->
---
feature: Bad Spec
tasks:
  - id: task-1
    depends-on: [nonexistent-task]
    title: Bad task
---

## task-1

This task references a nonexistent dependency.
```

- [ ] **Step 2: Write failing tests**

```typescript
// packages/orchestrator/test/spec-parser.test.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec-parser.js";

const FIXTURES = new URL("./fixtures", import.meta.url).pathname;

describe("SpecParser", () => {
  describe("valid specs", () => {
    it("parses a simple spec", () => {
      const spec = parseSpec(join(FIXTURES, "simple-spec.md"));
      expect(spec.feature).toBe("Smoke Test Feature");
      expect(spec.tasks).toHaveLength(1);
      expect(spec.tasks[0].id).toBe("task-1");
      expect(spec.tasks[0].title).toBe("Add a comment");
      expect(spec.tasks[0].model).toBe("claude-opus-4-6");     // default
      expect(spec.tasks[0].maxRetries).toBe(3);                 // default
      expect(spec.tasks[0].requiresScreenshots).toBe(false);    // default
      expect(spec.tasks[0].dependsOn).toEqual([]);
      expect(spec.tasks[0].description).toContain("ORCHESTRATOR_TEST");
    });

    it("parses a multi-task spec with dependencies", () => {
      const spec = parseSpec(join(FIXTURES, "multi-task-spec.md"));
      expect(spec.tasks).toHaveLength(2);
      expect(spec.tasks[1].dependsOn).toEqual(["task-1"]);
      expect(spec.tasks[1].requiresScreenshots).toBe(true);
      expect(spec.tasks[0].maxRetries).toBe(2);
    });
  });

  describe("validation errors", () => {
    it("throws on invalid depends-on reference", () => {
      expect(() => parseSpec(join(FIXTURES, "invalid-spec.md"))).toThrow(
        /depends-on.*nonexistent-task/i
      );
    });

    it("throws when context file does not exist", () => {
      let tempDir = "";
      try {
        tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });
        const specPath = join(tempDir, "spec.md");
        writeFileSync(
          specPath,
          `---\nfeature: Test\ncontext:\n  - /nonexistent/file.md\ntasks:\n  - id: task-1\n    title: T\n---\n\n## task-1\n\nDo it.`
        );
        expect(() => parseSpec(specPath)).toThrow(/context.*not found/i);
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws when task body is missing for declared task id", () => {
      let tempDir = "";
      try {
        tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });
        const specPath = join(tempDir, "spec.md");
        writeFileSync(
          specPath,
          `---\nfeature: Test\ntasks:\n  - id: task-1\n    title: T\n  - id: task-2\n    title: T2\n---\n\n## task-1\n\nDo it.`
          // task-2 has no body section
        );
        expect(() => parseSpec(specPath)).toThrow(/task-2.*no body/i);
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws when feature field is missing", () => {
      let tempDir = "";
      try {
        tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });
        const specPath = join(tempDir, "spec.md");
        writeFileSync(specPath, `---\ntasks: []\n---\n`);
        expect(() => parseSpec(specPath)).toThrow(/feature/i);
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
```

- [ ] **Step 3: Run tests — confirm they FAIL**

```bash
cd /Users/howard/learn-claude-agents/packages/orchestrator
bun test test/spec-parser.test.ts
```

Expected: FAIL — `Cannot find module '../src/spec-parser.js'`

- [ ] **Step 4: Implement SpecParser**

```typescript
// packages/orchestrator/src/spec-parser.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ParsedSpec, ParsedTask } from "./types.js";

const TaskFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  model: z.string().default("claude-opus-4-6"),
  "max-retries": z.number().int().min(1).default(3),
  "requires-screenshots": z.boolean().default(false),
  "depends-on": z.array(z.string()).default([]),
});

const SpecFrontmatterSchema = z.object({
  feature: z.string().min(1),
  context: z.array(z.string()).default([]),
  tasks: z.array(TaskFrontmatterSchema).min(1),
});

export class SpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecValidationError";
  }
}

export function parseSpec(filePath: string): ParsedSpec {
  const raw = readFileSync(filePath, "utf8");
  const specDir = dirname(resolve(filePath));

  // Split frontmatter from body
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new SpecValidationError("Spec file must start with YAML frontmatter (--- ... ---)");
  }

  const [, yamlStr, bodyStr] = fmMatch;

  // Parse + validate YAML
  let rawFm: unknown;
  try {
    rawFm = parseYaml(yamlStr);
  } catch (e) {
    throw new SpecValidationError(`Invalid YAML frontmatter: ${(e as Error).message}`);
  }

  const fmResult = SpecFrontmatterSchema.safeParse(rawFm);
  if (!fmResult.success) {
    const issues = fmResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new SpecValidationError(`Frontmatter validation failed: ${issues}`);
  }

  const fm = fmResult.data;

  // Validate context file paths
  for (const ctxPath of fm.context) {
    const abs = resolve(specDir, ctxPath);
    if (!existsSync(abs)) {
      throw new SpecValidationError(`Context file not found: ${ctxPath} (resolved to ${abs})`);
    }
  }

  // Validate depends-on references
  const taskIds = new Set(fm.tasks.map((t) => t.id));
  for (const task of fm.tasks) {
    for (const dep of task["depends-on"]) {
      if (!taskIds.has(dep)) {
        throw new SpecValidationError(
          `Task "${task.id}" depends-on "${dep}" which is not a declared task id`
        );
      }
    }
  }

  // Parse task body sections
  const taskBodies = new Map<string, string>();
  const sectionRegex = /^## (task-[\w-]+)\s*\n([\s\S]*?)(?=^## task-|$)/gm;
  for (const match of bodyStr.matchAll(sectionRegex)) {
    taskBodies.set(match[1].trim(), match[2].trim());
  }

  // Verify every declared task has a body
  for (const task of fm.tasks) {
    if (!taskBodies.has(task.id)) {
      throw new SpecValidationError(
        `Task "${task.id}" has no body section — add "## ${task.id}" to the markdown body`
      );
    }
  }

  const tasks: ParsedTask[] = fm.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    model: t.model,
    maxRetries: t["max-retries"],
    requiresScreenshots: t["requires-screenshots"],
    dependsOn: t["depends-on"],
    description: taskBodies.get(t.id)!,
  }));

  return {
    feature: fm.feature,
    contextFiles: fm.context.map((p) => resolve(specDir, p)),
    tasks,
  };
}
```

- [ ] **Step 5: Run tests — confirm they PASS**

```bash
bun test test/spec-parser.test.ts
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/spec-parser.ts packages/orchestrator/src/types.ts packages/orchestrator/test/spec-parser.test.ts packages/orchestrator/test/fixtures/
git commit -m "feat(orchestrator): add SpecParser with Zod validation"
```

---

## Chunk 2: ContextLoader + TaskRegistry + WorktreeManager

### Task 4: ContextLoader

**Files:**
- Create: `packages/orchestrator/src/context-loader.ts`
- Create: `packages/orchestrator/test/context-loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/test/context-loader.test.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContext } from "../src/context-loader.js";

describe("ContextLoader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `ctx-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads and concatenates context files", () => {
    writeFileSync(join(tempDir, "a.md"), "# File A\nContent A");
    writeFileSync(join(tempDir, "b.md"), "# File B\nContent B");
    const result = loadContext([join(tempDir, "a.md"), join(tempDir, "b.md")]);
    expect(result).toContain("File A");
    expect(result).toContain("File B");
  });

  it("returns empty string for no files", () => {
    expect(loadContext([])).toBe("");
  });

  it("truncates at character limit", () => {
    const big = "x".repeat(20_000);
    writeFileSync(join(tempDir, "big.md"), big);
    const result = loadContext([join(tempDir, "big.md")], 1000);
    expect(result.length).toBeLessThanOrEqual(1100); // some padding for header
  });

  it("labels each file with its path", () => {
    writeFileSync(join(tempDir, "customer.md"), "VIP customer info");
    const result = loadContext([join(tempDir, "customer.md")]);
    expect(result).toContain("customer.md");
    expect(result).toContain("VIP customer info");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/context-loader.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/context-loader.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_CHAR_LIMIT = 16_000; // ~4k tokens per file across multiple files

export function loadContext(filePaths: string[], charLimit = DEFAULT_CHAR_LIMIT): string {
  if (filePaths.length === 0) return "";

  const perFile = Math.floor(charLimit / filePaths.length);
  const sections: string[] = [];

  for (const filePath of filePaths) {
    const content = readFileSync(filePath, "utf8");
    const truncated = content.length > perFile ? content.slice(0, perFile) + "\n...[truncated]" : content;
    sections.push(`### Context: ${basename(filePath)}\n\n${truncated}`);
  }

  return sections.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/context-loader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/context-loader.ts packages/orchestrator/test/context-loader.test.ts
git commit -m "feat(orchestrator): add ContextLoader"
```

---

### Task 5: TaskRegistry

**Files:**
- Create: `packages/orchestrator/src/task-registry.ts`
- Create: `packages/orchestrator/test/task-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/test/task-registry.test.ts
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskRegistry } from "../src/task-registry.js";
import type { TaskRecord } from "../src/types.js";

function makeRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    branch: "agent/task-1",
    worktree: "/tmp/wt/task-1",
    baseCommitSha: "abc1234",
    status: "pending",
    attempts: 0,
    maxRetries: 3,
    attemptHistory: [],
    startedAt: Date.now(),
    model: "claude-opus-4-6",
    ...overrides,
  };
}

describe("TaskRegistry", () => {
  let tempDir: string;
  let registry: TaskRegistry;

  beforeEach(() => {
    tempDir = join(tmpdir(), `registry-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    registry = new TaskRegistry(join(tempDir, "active-tasks.json"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates and retrieves a record", async () => {
    const rec = makeRecord();
    await registry.set("task-1", rec);
    const got = await registry.get("task-1");
    expect(got?.id).toBe("task-1");
  });

  it("updates a record", async () => {
    await registry.set("task-1", makeRecord());
    await registry.update("task-1", { status: "running", attempts: 1 });
    const got = await registry.get("task-1");
    expect(got?.status).toBe("running");
    expect(got?.attempts).toBe(1);
  });

  it("returns running tasks", async () => {
    await registry.set("task-1", makeRecord({ status: "running" }));
    await registry.set("task-2", makeRecord({ id: "task-2", status: "done" }));
    const running = await registry.getRunning();
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe("task-1");
  });

  it("returns undefined for missing task", async () => {
    expect(await registry.get("nope")).toBeUndefined();
  });

  it("persists across instances", async () => {
    await registry.set("task-1", makeRecord({ status: "done" }));
    const registry2 = new TaskRegistry(join(tempDir, "active-tasks.json"));
    const got = await registry2.get("task-1");
    expect(got?.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/task-registry.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/task-registry.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TaskRecord, TaskStatus } from "./types.js";

type Registry = Record<string, TaskRecord>;

export class TaskRegistry {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  private load(): Registry {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as Registry;
    } catch {
      return {};
    }
  }

  private save(registry: Registry): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(registry, null, 2));
    renameSync(tmp, this.filePath); // atomic
  }

  async get(id: string): Promise<TaskRecord | undefined> {
    return this.load()[id];
  }

  async set(id: string, record: TaskRecord): Promise<void> {
    const registry = this.load();
    registry[id] = record;
    this.save(registry);
  }

  async update(id: string, patch: Partial<TaskRecord>): Promise<void> {
    const registry = this.load();
    if (!registry[id]) throw new Error(`Task "${id}" not found in registry`);
    registry[id] = { ...registry[id], ...patch };
    this.save(registry);
  }

  async getRunning(): Promise<TaskRecord[]> {
    return Object.values(this.load()).filter((r) => r.status === "running");
  }

  async getAll(): Promise<TaskRecord[]> {
    return Object.values(this.load());
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/task-registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/task-registry.ts packages/orchestrator/test/task-registry.test.ts
git commit -m "feat(orchestrator): add TaskRegistry with atomic writes"
```

---

### Task 6: WorktreeManager

**Files:**
- Create: `packages/orchestrator/src/worktree-manager.ts`
- Create: `packages/orchestrator/test/worktree-manager.test.ts`

- [ ] **Step 1: Write tests (mock execSync)**

```typescript
// packages/orchestrator/test/worktree-manager.test.ts
import { describe, expect, it, vi } from "vitest";

// Mock child_process before importing module under test
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { WorktreeManager } from "../src/worktree-manager.js";

describe("WorktreeManager", () => {
  it("create() runs git worktree add and captures base SHA", () => {
    const mockExec = vi.mocked(execSync);
    // First call: git rev-parse → returns SHA
    mockExec.mockReturnValueOnce(Buffer.from("abc1234\n"));
    // Second call: git worktree add
    mockExec.mockReturnValueOnce(Buffer.from(""));
    const manager = new WorktreeManager("/repo");
    const result = manager.create("task-1", "agent/task-1", "main");

    expect(result.path).toContain("task-1");
    expect(result.baseCommitSha).toBe("abc1234");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git rev-parse"),
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object)
    );
  });

  it("reset() runs git reset --hard to stored SHA", () => {
    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue(Buffer.from(""));

    const manager = new WorktreeManager("/repo");
    manager.reset("/tmp/wt/task-1", "abc1234");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git reset --hard abc1234"),
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git push --force-with-lease"),
      expect.any(Object)
    );
  });

  it("remove() runs git worktree remove", () => {
    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue(Buffer.from(""));

    const manager = new WorktreeManager("/repo");
    manager.remove("/tmp/wt/task-1");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git worktree remove"),
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/worktree-manager.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/worktree-manager.ts
import { execSync } from "node:child_process";
import { join } from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseCommitSha: string;
}

export class WorktreeManager {
  private readonly worktreesDir: string;

  constructor(private readonly repoRoot: string) {
    this.worktreesDir = join(repoRoot, ".worktrees");
  }

  create(taskId: string, branch: string, baseBranch: string): WorktreeInfo {
    const path = join(this.worktreesDir, taskId);
    const opts = { cwd: this.repoRoot, stdio: "pipe" as const };

    // Capture base commit SHA before any agent work
    const shaRaw = execSync(`git rev-parse ${baseBranch}`, opts);
    const baseCommitSha = shaRaw.toString().trim();

    // Create isolated worktree on a new branch
    execSync(`git worktree add -b ${branch} ${path} ${baseBranch}`, opts);
    // No npm install needed — monorepo hoists node_modules to root

    return { path, branch, baseCommitSha };
  }

  reset(worktreePath: string, baseCommitSha: string): void {
    const opts = { cwd: worktreePath, stdio: "pipe" as const };
    execSync(`git reset --hard ${baseCommitSha}`, opts);
    try {
      execSync("git push --force-with-lease", opts);
    } catch {
      // Branch may not be pushed yet — ignore
    }
  }

  remove(worktreePath: string): void {
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd: this.repoRoot,
      stdio: "pipe",
    });
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/worktree-manager.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/worktree-manager.ts packages/orchestrator/test/worktree-manager.test.ts
git commit -m "feat(orchestrator): add WorktreeManager"
```

---

## Chunk 3: PromptBuilder + AgentRunner

### Task 7: PromptBuilder

**Files:**
- Create: `packages/orchestrator/src/prompt-builder.ts`
- Create: `packages/orchestrator/test/prompt-builder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/test/prompt-builder.test.ts
import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/prompt-builder.js";
import type { ParsedTask } from "../src/types.js";

const task: ParsedTask = {
  id: "task-1",
  title: "Build API",
  model: "claude-opus-4-6",
  maxRetries: 3,
  requiresScreenshots: false,
  dependsOn: [],
  description: "Build a REST API endpoint for user profiles.",
};

describe("PromptBuilder", () => {
  it("includes task description", () => {
    const p = buildPrompt(task, "", [], "");
    expect(p).toContain("Build a REST API endpoint");
  });

  it("includes context when provided", () => {
    const p = buildPrompt(task, "## Context: vault.md\n\nVIP data", [], "");
    expect(p).toContain("VIP data");
  });

  it("includes completion gate instructions", () => {
    const p = buildPrompt(task, "", [], "");
    expect(p).toContain("<ready-for-review/>");
    expect(p).toContain("bun test");
    expect(p).toContain("git commit");
  });

  it("includes attempt history on retry", () => {
    const history = ["Attempt 1 failed: TypeError in src/api.ts at line 42"];
    const p = buildPrompt(task, "", history, "");
    expect(p).toContain("Previous Attempts");
    expect(p).toContain("TypeError");
    expect(p).toContain("different approach");
  });

  it("includes git log when provided", () => {
    const p = buildPrompt(task, "", [], "abc1234 feat: initial");
    expect(p).toContain("abc1234");
  });

  it("requires screenshots in gate when task demands it", () => {
    const screenshotTask = { ...task, requiresScreenshots: true };
    const p = buildPrompt(screenshotTask, "", [], "");
    expect(p).toContain("screenshot");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/prompt-builder.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/prompt-builder.ts
import type { ParsedTask } from "./types.js";

export function buildPrompt(
  task: ParsedTask,
  contextChunks: string,
  attemptHistory: string[],
  gitLog: string
): string {
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}\n\n${task.description}`);

  if (contextChunks) {
    parts.push(`## Business Context\n\n${contextChunks}`);
  }

  if (gitLog) {
    parts.push(`## Your Git History on This Branch\n\n\`\`\`\n${gitLog}\n\`\`\``);
  }

  if (attemptHistory.length > 0) {
    const historyText = attemptHistory
      .map((h, i) => `### Attempt ${i + 1}\n${h}`)
      .join("\n\n");
    parts.push(
      `## IMPORTANT: Previous Attempts Failed\n\n${historyText}\n\nYou MUST try a **different approach** than what was attempted before. Study the failure reasons carefully and change your implementation strategy.`
    );
  }

  const screenshotGate = task.requiresScreenshots
    ? "\n4. Take before/after screenshots and include them in the PR description"
    : "";

  parts.push(`## Local Completion Gate

Before finishing:
1. Run \`bun test && tsc --noEmit\` — ALL checks must pass
2. Run \`git add -A && git commit -m "feat: ${task.title}"\`${screenshotGate}

Only output \`<ready-for-review/>\` AFTER committing AND all local checks pass.
Do NOT output this signal until both conditions are true. You cannot lie to exit.`);

  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/prompt-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/prompt-builder.ts packages/orchestrator/test/prompt-builder.test.ts
git commit -m "feat(orchestrator): add PromptBuilder with ralph completion gate"
```

---

### Task 8: AgentRunner

**Files:**
- Create: `packages/orchestrator/src/agent-runner.ts`
- Create: `packages/orchestrator/test/agent-runner.integration.test.ts`

- [ ] **Step 1: Write integration tests (mock RpcClient)**

```typescript
// packages/orchestrator/test/agent-runner.integration.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

// Mock RpcClient at the module level
vi.mock("@mariozechner/pi-coding-agent/modes", () => {
  const mockClient = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockResolvedValue("Task complete"),
    onEvent: vi.fn(),
  };
  return {
    RpcClient: vi.fn(() => mockClient),
    _mockClient: mockClient,
  };
});

import { AgentRunner } from "../src/agent-runner.js";

describe("AgentRunner", () => {
  it("resolves when <ready-for-review/> is detected in event stream", async () => {
    const { RpcClient, _mockClient } = await import("@mariozechner/pi-coding-agent/modes");

    // Simulate event stream: message_end with TextContent containing completion signal
    _mockClient.onEvent.mockImplementation((cb: (e: AgentEvent) => void) => {
      setTimeout(() => {
        cb({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Work done. <ready-for-review/>" }],
          },
        } as unknown as AgentEvent);
      }, 10);
      return () => {};
    });

    const runner = new AgentRunner("/path/to/worktree");
    const result = await runner.run("Do some work", "claude-opus-4-6", 5000);
    expect(result.summary).toBe("Task complete");
  });

  it("rejects on timeout without completion signal", async () => {
    const { RpcClient, _mockClient } = await import("@mariozechner/pi-coding-agent/modes");

    _mockClient.onEvent.mockImplementation(() => () => {});  // never emits

    const runner = new AgentRunner("/path/to/worktree");
    await expect(runner.run("Do some work", "claude-opus-4-6", 100)).rejects.toThrow(/timeout/i);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/agent-runner.integration.test.ts
```

- [ ] **Step 3: Implement AgentRunner**

```typescript
// packages/orchestrator/src/agent-runner.ts
import { execSync } from "node:child_process";
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentResult } from "./types.js";

const COMPLETION_SIGNAL = "<ready-for-review/>";

export class AgentRunner {
  constructor(private readonly worktreePath: string) {}

  async run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000): Promise<AgentResult> {
    // One RpcClient per attempt — cwd pinned at construction time
    const client = new RpcClient({
      cwd: this.worktreePath,
      model,
    });

    await client.start();

    try {
      return await this.runWithTimeout(client, prompt, timeoutMs);
    } finally {
      await client.stop();
    }
  }

  private runWithTimeout(client: RpcClient, prompt: string, timeoutMs: number): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          reject(new Error(`Agent timed out after ${timeoutMs}ms without outputting <ready-for-review/>`));
        }
      }, timeoutMs);

      // Scan message_end content array for completion signal (per spec Section 6)
      const unsubscribe = client.onEvent((event: AgentEvent) => {
        if (event.type === "message_end") {
          const msg = (event as any).message;
          if (msg?.role === "assistant") {
            const text = (msg.content ?? [])
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text as string)
              .join("");
            if (text.includes(COMPLETION_SIGNAL) && !completed) {
              completed = true;
              clearTimeout(timer);
              unsubscribe?.();
              client.getLastAssistantText().then((summary) => {
                const sha = this.getHeadSha();
                resolve({ summary, lastCommitSha: sha });
              });
            }
          }
        }
      });

      // Start the agent
      client.prompt(prompt).catch(reject);
    });
  }

  private getHeadSha(): string {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.worktreePath,
        stdio: "pipe",
      }).toString().trim();
    } catch {
      return "unknown";
    }
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/agent-runner.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/agent-runner.ts packages/orchestrator/test/agent-runner.integration.test.ts
git commit -m "feat(orchestrator): add AgentRunner with ralph completion detection"
```

---

## Chunk 4: CIRunner + FailureExtractor + TaskScheduler

### Task 9: CIRunner

**Files:**
- Create: `packages/orchestrator/src/ci-runner.ts`
- Create: `packages/orchestrator/test/ci-runner.integration.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/test/ci-runner.integration.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { execSync, spawnSync } from "node:child_process";
import { CIRunner } from "../src/ci-runner.js";

describe("CIRunner", () => {
  it("runLocal passes when bun test and tsc succeed", () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from(""), stderr: null } as any)  // bun test
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from(""), stderr: null } as any); // tsc

    const runner = new CIRunner();
    const result = runner.runLocal("/tmp/worktree");
    expect(result.passed).toBe(true);
  });

  it("runLocal fails when bun test exits non-zero", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("2 tests failed"),
    } as any);

    const runner = new CIRunner();
    const result = runner.runLocal("/tmp/worktree");
    expect(result.passed).toBe(false);
    expect(result.errorOutput).toContain("2 tests failed");
  });

  it("runCloud parses gh pr checks output", async () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(JSON.stringify([{ name: "CI", conclusion: "success" }]))
    );

    const runner = new CIRunner();
    const result = await runner.runCloud("my-branch");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/ci-runner.integration.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/ci-runner.ts
import { execSync, spawnSync } from "node:child_process";
import type { CIResult } from "./types.js";

export class CIRunner {
  runLocal(worktreePath: string): CIResult {
    // Run bun test
    const testResult = spawnSync("bun", ["test"], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 5 * 60 * 1000,
    });

    if (testResult.status !== 0) {
      return {
        passed: false,
        failedChecks: ["bun test"],
        errorOutput: (testResult.stderr?.toString() ?? "") + (testResult.stdout?.toString() ?? ""),
      };
    }

    // Run TypeScript check
    const tscResult = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 2 * 60 * 1000,
    });

    if (tscResult.status !== 0) {
      return {
        passed: false,
        failedChecks: ["tsc --noEmit"],
        errorOutput: tscResult.stdout?.toString() ?? "",
      };
    }

    return { passed: true, failedChecks: [], errorOutput: "" };
  }

  async runCloud(branch: string): Promise<CIResult> {
    try {
      const raw = execSync(
        `gh pr checks --json name,status,conclusion --watch --interval 30`,
        { stdio: "pipe", timeout: 20 * 60 * 1000 }
      ).toString();

      const checks: Array<{ name: string; conclusion: string }> = JSON.parse(raw);
      const failed = checks.filter((c) => c.conclusion === "failure");

      return {
        passed: failed.length === 0,
        failedChecks: failed.map((c) => c.name),
        errorOutput: failed.length > 0 ? JSON.stringify(failed, null, 2) : "",
      };
    } catch (e) {
      return {
        passed: false,
        failedChecks: ["gh pr checks"],
        errorOutput: (e as Error).message,
      };
    }
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/ci-runner.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/ci-runner.ts packages/orchestrator/test/ci-runner.integration.test.ts
git commit -m "feat(orchestrator): add CIRunner (local + cloud)"
```

---

### Task 10: FailureExtractor

**Files:**
- Create: `packages/orchestrator/src/failure-extractor.ts`

> Note: FailureExtractor calls a real LLM. Unit test it by mocking `RpcClient`. Integration test via E2E smoke only.

- [ ] **Step 1: Implement**

```typescript
// packages/orchestrator/src/failure-extractor.ts
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { FailureContext } from "./types.js";

const MAX_CI_OUTPUT = 3_000;

export class FailureExtractor {
  async extract(ciErrorOutput: string): Promise<FailureContext> {
    const truncated = ciErrorOutput.slice(0, MAX_CI_OUTPUT);

    // Use the smallest/fastest available model — resolve dynamically
    const client = new RpcClient({});
    await client.start();

    try {
      const models = await client.getAvailableModels();
      // Prefer haiku-tier (fastest + cheapest)
      const smallModel =
        models.find((m) => m.id.includes("haiku"))?.id ??
        models.find((m) => m.id.includes("flash"))?.id ??
        models[0]?.id ??
        "claude-haiku-4-5-20251001";

      await client.setModel("anthropic", smallModel);

      const events = await client.promptAndWait(
        `Extract the root cause of this CI failure. Be concise. Output ONLY valid JSON matching this schema:
{ "summary": "2-3 sentence root cause", "failedTests": ["test name 1"], "approach": "what the previous implementation tried" }

CI output:
${truncated}`,
        [],
        30_000
      );

      const text = await client.getLastAssistantText();
      if (!text) throw new Error("No response from failure extractor");

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in extractor response");

      return JSON.parse(jsonMatch[0]) as FailureContext;
    } catch {
      // Fallback: return raw error output as summary
      return {
        summary: truncated.slice(0, 500),
        failedTests: [],
        approach: "unknown",
      };
    } finally {
      await client.stop();
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/failure-extractor.ts
git commit -m "feat(orchestrator): add FailureExtractor using small LLM"
```

---

### Task 11: TaskScheduler

**Files:**
- Create: `packages/orchestrator/src/task-scheduler.ts`
- Create: `packages/orchestrator/test/task-scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/test/task-scheduler.test.ts
import { describe, expect, it, vi } from "vitest";
import { TaskScheduler } from "../src/task-scheduler.js";
import type { ParsedTask } from "../src/types.js";

function makeTask(id: string, dependsOn: string[] = []): ParsedTask {
  return { id, title: id, model: "claude-opus-4-6", maxRetries: 3, requiresScreenshots: false, dependsOn, description: "Do it" };
}

describe("TaskScheduler", () => {
  it("runs independent tasks concurrently", async () => {
    const order: string[] = [];
    const scheduler = new TaskScheduler(3);

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    await scheduler.run(tasks, async (task) => {
      order.push(task.id);
    });

    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
  });

  it("respects depends-on ordering", async () => {
    const completedAt: Record<string, number> = {};
    const scheduler = new TaskScheduler(3);

    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]), // b depends on a
    ];

    await scheduler.run(tasks, async (task) => {
      await new Promise((r) => setTimeout(r, 10));
      completedAt[task.id] = Date.now();
    });

    expect(completedAt["a"]).toBeLessThan(completedAt["b"]);
  });

  it("respects max concurrency", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const scheduler = new TaskScheduler(2); // max 2 at a time

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c"), makeTask("d")];
    await scheduler.run(tasks, async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test test/task-scheduler.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/task-scheduler.ts
import type { ParsedTask } from "./types.js";

export class TaskScheduler {
  constructor(private readonly maxConcurrent = 3) {}

  async run(
    tasks: ParsedTask[],
    execute: (task: ParsedTask) => Promise<void>
  ): Promise<void> {
    const completed = new Set<string>();
    const running = new Map<string, Promise<void>>();
    const remaining = [...tasks];

    while (remaining.length > 0 || running.size > 0) {
      // Start eligible tasks (deps met, under concurrency limit)
      for (let i = remaining.length - 1; i >= 0; i--) {
        const task = remaining[i];
        const depsmet = task.dependsOn.every((dep) => completed.has(dep));
        if (depsmet && running.size < this.maxConcurrent) {
          remaining.splice(i, 1);
          const p = execute(task).then(() => {
            completed.add(task.id);
            running.delete(task.id);
          });
          running.set(task.id, p);
        }
      }

      if (running.size === 0 && remaining.length > 0) {
        throw new Error("Deadlock: remaining tasks have unresolvable dependencies");
      }

      if (running.size > 0) {
        await Promise.race(running.values());
      }
    }
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
bun test test/task-scheduler.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/task-scheduler.ts packages/orchestrator/test/task-scheduler.test.ts
git commit -m "feat(orchestrator): add TaskScheduler with dependency graph + semaphore"
```

---

## Chunk 5: ReviewOrchestrator + Notifier + Entry Point

### Task 12: ReviewOrchestrator

**Files:**
- Create: `packages/orchestrator/src/review-orchestrator.ts`
- Test: `packages/orchestrator/test/review-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/orchestrator/test/review-orchestrator.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("diff --git a/foo.ts b/foo.ts\n+new line")),
}));

const mockGetLastAssistantText = vi.fn();
const mockPromptAndWait = vi.fn().mockResolvedValue(undefined);
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);

vi.mock("@mariozechner/pi-coding-agent/modes", () => ({
  RpcClient: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    promptAndWait: mockPromptAndWait,
    getLastAssistantText: mockGetLastAssistantText,
  })),
}));

import { ReviewOrchestrator } from "./review-orchestrator.js";

describe("ReviewOrchestrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes when no reviewer returns CRITICAL issues", async () => {
    mockGetLastAssistantText.mockResolvedValue("LGTM — no issues found.");
    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(true);
    expect(result.criticalIssues).toHaveLength(0);
  });

  it("fails and surfaces CRITICAL issues from reviewers", async () => {
    mockGetLastAssistantText
      .mockResolvedValueOnce("CRITICAL: SQL injection in line 12")
      .mockResolvedValue("LGTM");
    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(false);
    expect(result.criticalIssues.some((i) => i.includes("SQL injection"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/orchestrator && bun test src/review-orchestrator.test.ts
```

Expected: FAIL — `review-orchestrator.ts` not found.

- [ ] **Step 3: Implement (mock-friendly, reviewers injected)**

```typescript
// packages/orchestrator/src/review-orchestrator.ts
import { execSync } from "node:child_process";
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { ReviewResult } from "./types.js";

interface ReviewerConfig {
  name: string;
  provider: string;
  model: string;
  focus: string;
  apiKeyEnv: string;
}

const REVIEWERS: ReviewerConfig[] = [
  {
    name: "Codex",
    provider: "openai",
    model: "gpt-5.3-codex",
    focus: "Edge cases, logic errors, race conditions, missing error handling",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "Copilot",
    provider: "github-copilot",
    model: "copilot",
    focus: "Repo conventions, GitHub-native patterns, inline suggestions",
    apiKeyEnv: "GITHUB_TOKEN",
  },
  {
    name: "Gemini",
    provider: "google",
    model: "gemini-2.0-flash",
    focus: "Security vulnerabilities, accessibility, scalability issues",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    name: "Claude",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    focus: "Correctness validation. Flag CRITICAL issues only — ignore style.",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
];

export class ReviewOrchestrator {
  async review(prNumber: number): Promise<ReviewResult> {
    let diff = "";
    try {
      diff = execSync(`gh pr diff ${prNumber}`, { stdio: "pipe" }).toString().slice(0, 8_000);
    } catch (e) {
      return { passed: false, criticalIssues: [`Failed to fetch PR diff: ${(e as Error).message}`] };
    }

    const results = await Promise.allSettled(
      REVIEWERS.filter((r) => process.env[r.apiKeyEnv]).map((r) =>
        this.runReviewer(r, prNumber, diff)
      )
    );

    const criticalIssues: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        criticalIssues.push(...result.value);
      }
    }

    return { passed: criticalIssues.length === 0, criticalIssues };
  }

  private async runReviewer(
    reviewer: ReviewerConfig,
    prNumber: number,
    diff: string
  ): Promise<string[]> {
    const client = new RpcClient({
      provider: reviewer.provider,
      model: reviewer.model,
      env: { [reviewer.apiKeyEnv]: process.env[reviewer.apiKeyEnv] ?? "" },
    });

    await client.start();

    try {
      await client.promptAndWait(
        `You are a ${reviewer.name} code reviewer. Focus: ${reviewer.focus}

Review this PR diff and use the \`gh\` bash tool to post your review comments directly on PR #${prNumber}.

For CRITICAL issues: prefix with "CRITICAL: "
For minor issues: skip them.
If no critical issues: post a short approval comment.

PR Diff:
${diff}`,
        [],
        5 * 60 * 1000
      );

      const text = await client.getLastAssistantText();
      const criticals = (text ?? "")
        .split("\n")
        .filter((l) => l.startsWith("CRITICAL:"))
        .map((l) => `[${reviewer.name}] ${l}`);

      return criticals;
    } finally {
      await client.stop();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/orchestrator && bun test src/review-orchestrator.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/review-orchestrator.ts packages/orchestrator/test/review-orchestrator.test.ts
git commit -m "feat(orchestrator): add ReviewOrchestrator (4 parallel reviewers)"
```

---

### Task 13: Notifier

**Files:**
- Create: `packages/orchestrator/src/notifier.ts`
- Test: `packages/orchestrator/test/notifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/orchestrator/test/notifier.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { Notifier } from "../src/notifier.js";

describe("Notifier", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123456";
    mockFetch.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.clearAllMocks();
  });

  it("sends a ready notification via Telegram fetch", async () => {
    const notifier = new Notifier();
    await notifier.notifyReady("task-1", 42, "https://github.com/org/repo/pull/42");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("test-token");
    expect(url).toContain("sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("123456");
    expect(body.text).toContain("task-1");
    expect(body.text).toContain("#42");
  });

  it("logs to console when tokens are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const notifier = new Notifier();
    await notifier.notifyFailed("task-2", 3, "CI exploded");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/orchestrator && bun test test/notifier.test.ts
```

Expected: FAIL — `notifier.ts` not found.

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/notifier.ts

export class Notifier {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.chatId = process.env.TELEGRAM_CHAT_ID ?? "";
  }

  async notifyReady(taskId: string, prNumber: number, prUrl: string): Promise<void> {
    await this.send(
      `✅ *PR Ready to Merge*\n\nTask: \`${taskId}\`\nPR: [#${prNumber}](${prUrl})\n\nAll checks passed. Four AI reviewers approved. Ready for your review.`
    );
  }

  async notifyFailed(taskId: string, attempts: number, lastError: string): Promise<void> {
    await this.send(
      `❌ *Task Needs Attention*\n\nTask: \`${taskId}\`\nAttempts: ${attempts}\n\nFailed after ${attempts} attempts.\nLast error: ${lastError.slice(0, 200)}`
    );
  }

  private async send(text: string): Promise<void> {
    if (!this.botToken || !this.chatId) {
      console.log(`[Notifier] ${text}`);
      return;
    }

    await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/orchestrator && bun test test/notifier.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/notifier.ts packages/orchestrator/test/notifier.test.ts
git commit -m "feat(orchestrator): add Telegram Notifier"
```

---

### Task 14: Core orchestration loop + CLI entry point

**Files:**
- Create: `packages/orchestrator/src/index.ts`  ← core `runTask` + `orchestrate` functions
- Create: `packages/orchestrator/orchestrate.ts`  ← CLI entry point
- Test: `packages/orchestrator/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/orchestrator/test/index.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" }),
  })),
}));
vi.mock("../src/ci-runner.js", () => ({
  CIRunner: vi.fn().mockImplementation(() => ({
    runLocal: vi.fn().mockResolvedValue({ passed: true }),
    runCloud: vi.fn().mockResolvedValue({ passed: true, failedChecks: [], errorOutput: "" }),
  })),
}));
vi.mock("../src/review-orchestrator.js", () => ({
  ReviewOrchestrator: vi.fn().mockImplementation(() => ({
    review: vi.fn().mockResolvedValue({ passed: true, criticalIssues: [] }),
  })),
}));
vi.mock("../src/notifier.js", () => ({
  Notifier: vi.fn().mockImplementation(() => ({
    notifyReady: vi.fn().mockResolvedValue(undefined),
    notifyFailed: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../src/worktree-manager.js", () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockReturnValue({ path: "/wt/task-1", branch: "agent/task-1", baseCommitSha: "base123" }),
    remove: vi.fn(),
    reset: vi.fn(),
  })),
}));
vi.mock("../src/task-registry.js", () => ({
  TaskRegistry: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getRunning: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("../src/failure-extractor.js", () => ({
  FailureExtractor: vi.fn().mockImplementation(() => ({
    extract: vi.fn().mockResolvedValue({ summary: "test failed", failedTests: [], approach: "retry" }),
  })),
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

import { runTaskWithRetry } from "../src/index.js";

const mockTask = {
  id: "task-1", title: "Backend API", description: "Build the API",
  model: "claude-opus-4-6", maxRetries: 3, requiresScreenshots: false, dependsOn: [],
};

describe("runTaskWithRetry", () => {
  it("returns success=true when agent + CI + review all pass on first attempt", async () => {
    const result = await runTaskWithRetry(mockTask, ["context chunk"], "main");
    expect(result.success).toBe(true);
    expect(result.prNumber).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/orchestrator && bun test test/index.test.ts
```

Expected: FAIL — `index.ts` not found.

- [ ] **Step 3: Implement core loop**

```typescript
// packages/orchestrator/src/index.ts
import { execSync } from "node:child_process";
import { loadContext as _loadContext } from "./context-loader.js";
import { AgentRunner } from "./agent-runner.js";
import { CIRunner } from "./ci-runner.js";
import { ContextLoader } from "./context-loader.js";
import { FailureExtractor } from "./failure-extractor.js";
import { Notifier } from "./notifier.js";
import { buildPrompt } from "./prompt-builder.js";
import { parseSpec } from "./spec-parser.js";
import { ReviewOrchestrator } from "./review-orchestrator.js";
import { TaskRegistry } from "./task-registry.js";
import { TaskScheduler } from "./task-scheduler.js";
import type { ParsedSpec, ParsedTask, TaskRunResult } from "./types.js";
import { WorktreeManager } from "./worktree-manager.js";

export { parseSpec };

const REGISTRY_PATH = ".clawdbot/active-tasks.json";

export async function orchestrate(specPath: string): Promise<void> {
  const spec = parseSpec(specPath);
  console.log(`\n[Orchestrator] Feature: ${spec.feature}`);
  console.log(`[Orchestrator] Tasks: ${spec.tasks.map((t) => t.id).join(", ")}`);

  const registry = new TaskRegistry(REGISTRY_PATH);
  const scheduler = new TaskScheduler(3);
  const notifier = new Notifier();

  await scheduler.run(spec.tasks, async (task) => {
    const result = await runTask(task, spec, registry);
    if (result.success) {
      await notifier.notifyReady(task.id, result.prNumber!, result.prUrl!);
    } else {
      await notifier.notifyFailed(task.id, task.maxRetries, result.failureReason ?? "unknown");
    }
  });
}

async function runTask(
  task: ParsedTask,
  spec: ParsedSpec,
  registry: TaskRegistry
): Promise<TaskRunResult> {
  const repoRoot = process.cwd();
  const worktreeManager = new WorktreeManager(repoRoot);
  const ciRunner = new CIRunner();
  const failureExtractor = new FailureExtractor();
  const reviewOrchestrator = new ReviewOrchestrator();
  const contextChunks = loadContext(spec.contextFiles);

  const branch = `agent/${task.id}-${Date.now()}`;
  const wt = worktreeManager.create(task.id, branch, "main");

  await registry.set(task.id, {
    id: task.id,
    branch,
    worktree: wt.path,
    baseCommitSha: wt.baseCommitSha,
    status: "running",
    attempts: 0,
    maxRetries: task.maxRetries,
    attemptHistory: [],
    startedAt: Date.now(),
    model: task.model,
  });

  const attemptHistory: string[] = [];

  for (let attempt = 1; attempt <= task.maxRetries; attempt++) {
    console.log(`\n[${task.id}] Attempt ${attempt}/${task.maxRetries}`);
    await registry.update(task.id, { attempts: attempt });

    try {
      // Get git log for context (previous agent commits on this branch)
      let gitLog = "";
      try {
        gitLog = execSync(`git log --oneline -10`, { cwd: wt.path, stdio: "pipe" }).toString();
      } catch { /* empty branch */ }

      // Build prompt with full context + failure history
      const prompt = buildPrompt(task, contextChunks, attemptHistory, gitLog);

      // Run inner loop (agent self-certifies)
      const agentRunner = new AgentRunner(wt.path);
      await agentRunner.run(prompt, task.model);

      // Create or update PR
      const prNumber = await createOrUpdatePR(wt.path, branch, task.title, attempt);

      // Run local CI
      const localCI = ciRunner.runLocal(wt.path);
      if (!localCI.passed) {
        const failure = await failureExtractor.extract(localCI.errorOutput);
        attemptHistory.push(
          `Attempt ${attempt} (local CI failed):\n${failure.summary}\nFailed: ${failure.failedTests.join(", ")}`
        );
        await registry.update(task.id, { attemptHistory });
        worktreeManager.reset(wt.path, wt.baseCommitSha);
        continue;
      }

      // Run cloud CI
      const cloudCI = await ciRunner.runCloud(branch);
      if (!cloudCI.passed) {
        const ciLogs = await fetchCILogs(prNumber);
        const failure = await failureExtractor.extract(ciLogs || cloudCI.errorOutput);
        attemptHistory.push(
          `Attempt ${attempt} (cloud CI failed):\n${failure.summary}\nFailed checks: ${cloudCI.failedChecks.join(", ")}`
        );
        await registry.update(task.id, { attemptHistory });
        worktreeManager.reset(wt.path, wt.baseCommitSha);
        continue;
      }

      // Run four-reviewer review
      const review = await reviewOrchestrator.review(prNumber);
      if (!review.passed) {
        attemptHistory.push(
          `Attempt ${attempt} (review failed):\nCritical issues:\n${review.criticalIssues.join("\n")}`
        );
        await registry.update(task.id, { attemptHistory });
        worktreeManager.reset(wt.path, wt.baseCommitSha);
        continue;
      }

      // All checks passed
      const prUrl = getPRUrl(prNumber);
      await registry.update(task.id, {
        status: "done",
        pr: prNumber,
        prUrl,
        completedAt: Date.now(),
        checks: {
          prCreated: true,
          localCIPassed: true,
          cloudCIPassed: true,
          codexReviewPassed: true,
          copilotReviewPassed: true,
          geminiReviewPassed: true,
          claudeReviewPassed: true,
          screenshotsIncluded: task.requiresScreenshots
            ? /!\[.*\]\(/.test(
                execSync(`gh pr view ${prNumber} --json body -q .body`, { stdio: "pipe" }).toString()
              )
            : false, // not required for this task
        },
      });

      console.log(`[${task.id}] ✅ Done — PR #${prNumber}`);
      return { success: true, prNumber, prUrl, attemptHistory };
    } catch (e) {
      const msg = (e as Error).message;
      attemptHistory.push(`Attempt ${attempt} (error): ${msg}`);
      await registry.update(task.id, { attemptHistory });
      if (attempt < task.maxRetries) {
        worktreeManager.reset(wt.path, wt.baseCommitSha);
      }
    }
  }

  await registry.update(task.id, { status: "failed", completedAt: Date.now() });
  worktreeManager.remove(wt.path);

  return {
    success: false,
    failureReason: `All ${task.maxRetries} attempts failed`,
    attemptHistory,
  };
}

function loadContext(contextFiles: string[]): string {
  return _loadContext(contextFiles);
}

async function createOrUpdatePR(
  worktreePath: string,
  branch: string,
  title: string,
  attempt: number
): Promise<number> {
  const opts = { cwd: worktreePath, stdio: "pipe" as const };

  if (attempt === 1) {
    // First attempt: push + create PR
    execSync(`git push -u origin ${branch}`, opts);
    const out = execSync(`gh pr create --title "${title}" --body "Automated by Pi Orchestrator" --fill`, opts);
    const match = out.toString().match(/\/pull\/(\d+)/);
    return parseInt(match?.[1] ?? "0", 10);
  } else {
    // Subsequent attempts: force push (worktree was reset)
    execSync(`git push --force-with-lease origin ${branch}`, opts);
    const out = execSync(`gh pr view --json number`, opts);
    return JSON.parse(out.toString()).number;
  }
}

function getPRUrl(prNumber: number): string {
  try {
    const out = execSync(`gh pr view ${prNumber} --json url`, { stdio: "pipe" });
    return JSON.parse(out.toString()).url;
  } catch {
    return `https://github.com/pull/${prNumber}`;
  }
}

async function fetchCILogs(prNumber: number): Promise<string> {
  try {
    return execSync(`gh run list --json databaseId --limit 1 | gh run view --log-failed`, {
      stdio: "pipe",
    }).toString().slice(0, 3_000);
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/orchestrator && bun test test/index.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Create CLI entry point**

```typescript
// packages/orchestrator/orchestrate.ts
#!/usr/bin/env node
import { orchestrate } from "./src/index.js";

const specPath = process.argv[2];

if (!specPath) {
  console.error("Usage: orchestrate <spec.md>");
  process.exit(1);
}

orchestrate(specPath).catch((e) => {
  console.error("[Orchestrator] Fatal error:", e.message);
  process.exit(1);
});
```

- [ ] **Step 6: Build**

```bash
cd /Users/howard/learn-claude-agents/packages/orchestrator
bun run build
```

Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/index.ts packages/orchestrator/orchestrate.ts packages/orchestrator/test/index.test.ts
git commit -m "feat(orchestrator): add core orchestration loop and CLI entry point"
```

---

### Task 15: E2E Smoke Test

**Files:**
- Create: `packages/orchestrator/test/smoke.e2e.test.ts`

- [ ] **Step 1: Write smoke test**

```typescript
// packages/orchestrator/test/smoke.e2e.test.ts
import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only runs when ANTHROPIC_API_KEY is present
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Pi Orchestrator E2E smoke test", () => {
  it(
    "orchestrates a single minimal task end-to-end",
    async () => {
      // This test requires:
      // - ANTHROPIC_API_KEY in env
      // - gh CLI authenticated
      // - Running inside a git repo with push access
      // It does NOT run in normal CI — only manual verification

      const { orchestrate } = await import("../src/index.js");

      let tempDir = "";
      try {
        tempDir = join(tmpdir(), `smoke-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });

        const specPath = join(tempDir, "smoke-spec.md");
        writeFileSync(
          specPath,
          `---
feature: Smoke Test
context: []
tasks:
  - id: smoke-task-1
    title: Add test comment
    max-retries: 1
---

## smoke-task-1

Add the comment \`// SMOKE_TEST_${Date.now()}\` to any file in the project as a new line.
Commit this single change and output <ready-for-review/>.
`
        );

        // Should complete without throwing
        await expect(orchestrate(specPath)).resolves.toBeUndefined();
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    },
    { timeout: 10 * 60 * 1000 } // 10 minutes
  );
});
```

- [ ] **Step 2: Verify it skips without API key**

```bash
bun test test/smoke.e2e.test.ts
```

Expected: `1 skipped` (no ANTHROPIC_API_KEY in env)

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/howard/learn-claude-agents/packages/orchestrator
bun test
```

Expected: All unit + integration tests pass. E2E skipped.

- [ ] **Step 4: Final commit**

```bash
git add packages/orchestrator/test/smoke.e2e.test.ts
git commit -m "feat(orchestrator): add E2E smoke test"
```

---

### Task 16: Add to monorepo build

- [ ] **Step 1: Add orchestrator to root build script**

In root `package.json`, add to the `"build"` script:

```
&& cd ../orchestrator && bun run build
```

- [ ] **Step 2: Test full monorepo build**

```bash
cd /Users/howard/learn-claude-agents
bun test --filter packages/orchestrator
```

- [ ] **Step 3: Final commit**

```bash
git add package.json
git commit -m "feat(orchestrator): integrate into monorepo build"
```

---

## Verification

After all tasks complete, run:

```bash
cd /Users/howard/learn-claude-agents/packages/orchestrator
bun test
```

Expected output:
```
✓ spec-parser.test.ts (7 tests)
✓ context-loader.test.ts (4 tests)
✓ task-registry.test.ts (5 tests)
✓ worktree-manager.test.ts (3 tests)
✓ prompt-builder.test.ts (6 tests)
✓ agent-runner.integration.test.ts (2 tests)
✓ ci-runner.integration.test.ts (3 tests)
✓ task-scheduler.test.ts (3 tests)
↓ smoke.e2e.test.ts (1 skipped — no API key)

Test Files  8 passed (9)
Tests      33 passed | 1 skipped (34)
```

Manual smoke test (requires API key + gh auth):
```bash
ANTHROPIC_API_KEY=sk-... bun test test/smoke.e2e.test.ts
```
