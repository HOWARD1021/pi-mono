import { describe, expect, it, vi } from "vitest";
import { FailureExtractor } from "../src/failure-extractor.js";

// Mock execSync so tests don't spawn real processes
vi.mock("node:child_process", () => ({
	execSync: vi.fn((cmd: string) => {
		if (cmd.includes("git log")) return Buffer.from("feat: implement foo via direct string replace");
		if (cmd.includes("git diff")) return Buffer.from("src/foo.ts\nsrc/bar.ts");
		// Simulate claude -p returning JSON
		return Buffer.from(
			JSON.stringify({
				summary: "TypeError at line 12: cannot read property 'x'",
				failedTests: ["test foo returns value"],
				approach: "direct string replace in foo.ts",
			}),
		);
	}),
	spawn: vi.fn(),
}));

describe("FailureExtractor", () => {
	it("returns FailureContext with summary, failedTests, and approach", async () => {
		const extractor = new FailureExtractor();
		const result = await extractor.extract("FAIL: test foo returns value\nTypeError at line 12");
		expect(result).toHaveProperty("summary");
		expect(result).toHaveProperty("failedTests");
		expect(result).toHaveProperty("approach");
		expect(Array.isArray(result.failedTests)).toBe(true);
	});

	it("includes git context in extraction prompt when worktreePath provided", async () => {
		const { execSync } = await import("node:child_process");
		const extractor = new FailureExtractor();
		await extractor.extract("some CI error", "/fake/worktree");
		// Should have called git log and git diff for git context
		const calls = (execSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
		expect(calls.some((c) => c.includes("git log"))).toBe(true);
		expect(calls.some((c) => c.includes("git diff"))).toBe(true);
	});

	it("falls back gracefully when claude -p fails", async () => {
		const { execSync } = await import("node:child_process");
		(execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
			throw new Error("claude not found");
		});
		const extractor = new FailureExtractor();
		const result = await extractor.extract("raw CI error output");
		expect(result.approach).toBe("unknown");
		expect(result.failedTests).toEqual([]);
	});
});
