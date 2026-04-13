import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
			expect(spec.tasks[0].model).toBe("claude-opus-4-6"); // default
			expect(spec.tasks[0].maxRetries).toBe(3); // default
			expect(spec.tasks[0].requiresScreenshots).toBe(false); // default
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
			expect(() => parseSpec(join(FIXTURES, "invalid-spec.md"))).toThrow(/depends-on.*nonexistent-task/i);
		});

		it("throws when context file does not exist", () => {
			let tempDir = "";
			try {
				tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
				mkdirSync(tempDir, { recursive: true });
				const specPath = join(tempDir, "spec.md");
				writeFileSync(
					specPath,
					`---\nfeature: Test\ncontext:\n  - /nonexistent/file.md\ntasks:\n  - id: task-1\n    title: T\n---\n\n## task-1\n\nDo it.`,
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
					`---\nfeature: Test\ntasks:\n  - id: task-1\n    title: T\n  - id: task-2\n    title: T2\n---\n\n## task-1\n\nDo it.`,
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

	describe("fallback model / runner", () => {
		it("parses fallback-model and fallback-runner when declared", () => {
			const spec = parseSpec(join(FIXTURES, "fallback-spec.md"));
			expect(spec.tasks[0].fallbackModel).toBe("claude-sonnet-4-6");
			expect(spec.tasks[0].fallbackRunner).toBe("claude");
		});

		it("fallbackModel and fallbackRunner are undefined when not declared", () => {
			const spec = parseSpec(join(FIXTURES, "simple-spec.md"));
			expect(spec.tasks[0].fallbackModel).toBeUndefined();
			expect(spec.tasks[0].fallbackRunner).toBeUndefined();
		});

		it("allows setting fallback-model without fallback-runner", () => {
			let tempDir = "";
			try {
				tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
				mkdirSync(tempDir, { recursive: true });
				const specPath = join(tempDir, "spec.md");
				writeFileSync(
					specPath,
					`---\nfeature: Test\ntasks:\n  - id: task-1\n    title: T\n    fallback-model: claude-opus-4-6\n---\n\n## task-1\n\nDo it.`,
				);
				const spec = parseSpec(specPath);
				expect(spec.tasks[0].fallbackModel).toBe("claude-opus-4-6");
				expect(spec.tasks[0].fallbackRunner).toBeUndefined();
			} finally {
				if (tempDir) rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe("eval spec parsing", () => {
		function makeEvalSpec(evalBlock: string): string {
			return `---
feature: Eval Test
${evalBlock}
tasks:
  - id: task-1
    title: Improve coverage
---

## task-1

Write more tests.
`;
		}

		it("parses eval block with type, runner, target", () => {
			let tempDir = "";
			try {
				tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
				mkdirSync(tempDir, { recursive: true });
				const specPath = join(tempDir, "spec.md");
				writeFileSync(
					specPath,
					makeEvalSpec(`eval:
  type: track-a
  runner: code-coverage
  target: 85`),
				);

				const spec = parseSpec(specPath);
				expect(spec.eval).toBeDefined();
				expect(spec.eval!.type).toBe("track-a");
				expect(spec.eval!.runner).toBe("code-coverage");
				expect(spec.eval!.target).toBe(85);
			} finally {
				if (tempDir) rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("parses optional maxGenerations and timeBudgetMs", () => {
			let tempDir = "";
			try {
				tempDir = join(tmpdir(), `spec-test-${Date.now()}`);
				mkdirSync(tempDir, { recursive: true });
				const specPath = join(tempDir, "spec.md");
				writeFileSync(
					specPath,
					makeEvalSpec(`eval:
  type: track-a
  runner: code-coverage
  target: 90
  max-generations: 10
  time-budget-ms: 3600000`),
				);

				const spec = parseSpec(specPath);
				expect(spec.eval!.maxGenerations).toBe(10);
				expect(spec.eval!.timeBudgetMs).toBe(3600000);
			} finally {
				if (tempDir) rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("eval is undefined when not present", () => {
			const spec = parseSpec(join(FIXTURES, "simple-spec.md"));
			expect(spec.eval).toBeUndefined();
		});
	});
});
