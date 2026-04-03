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
});
