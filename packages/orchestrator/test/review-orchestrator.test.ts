import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { ReviewOrchestrator } from "../src/review-orchestrator.js";

const DIFF = "diff --git a/foo.ts b/foo.ts\n+new line";

describe("ReviewOrchestrator", () => {
	beforeEach(() => vi.clearAllMocks());

	it("passes when all reviewers return no CRITICAL issues", async () => {
		vi.mocked(execSync)
			.mockReturnValueOnce(Buffer.from(DIFF)) // gh pr diff
			.mockReturnValueOnce(Buffer.from("LGTM")) // Claude
			.mockReturnValueOnce(Buffer.from("LGTM")) // Gemini
			.mockReturnValueOnce(Buffer.from("LGTM")) // Copilot
			.mockReturnValueOnce(Buffer.from("LGTM")); // Codex

		const result = await new ReviewOrchestrator().review(42);
		expect(result.passed).toBe(true);
		expect(result.criticalIssues).toHaveLength(0);
	});

	it("fails when Claude finds a CRITICAL issue", async () => {
		vi.mocked(execSync)
			.mockReturnValueOnce(Buffer.from(DIFF))
			.mockReturnValueOnce(Buffer.from("CRITICAL: SQL injection in line 12")) // Claude
			.mockReturnValueOnce(Buffer.from("LGTM")) // Gemini
			.mockReturnValueOnce(Buffer.from("LGTM")) // Copilot
			.mockReturnValueOnce(Buffer.from("LGTM")); // Codex

		const result = await new ReviewOrchestrator().review(42);
		expect(result.passed).toBe(false);
		expect(result.criticalIssues.some((i) => i.includes("[Claude]") && i.includes("SQL injection"))).toBe(true);
	});

	it("fails when any reviewer finds a CRITICAL issue", async () => {
		vi.mocked(execSync)
			.mockReturnValueOnce(Buffer.from(DIFF))
			.mockReturnValueOnce(Buffer.from("LGTM")) // Claude
			.mockReturnValueOnce(Buffer.from("CRITICAL: hardcoded secret")) // Gemini
			.mockReturnValueOnce(Buffer.from("LGTM")) // Copilot
			.mockReturnValueOnce(Buffer.from("LGTM")); // Codex

		const result = await new ReviewOrchestrator().review(42);
		expect(result.passed).toBe(false);
		expect(result.criticalIssues.some((i) => i.includes("[Gemini]"))).toBe(true);
	});

	it("degrades gracefully when a non-critical reviewer CLI throws", async () => {
		vi.mocked(execSync)
			.mockReturnValueOnce(Buffer.from(DIFF))
			.mockReturnValueOnce(Buffer.from("LGTM")) // Claude
			.mockImplementationOnce(() => {
				throw new Error("gemini: command not found");
			}) // Gemini throws
			.mockReturnValueOnce(Buffer.from("LGTM")) // Copilot
			.mockReturnValueOnce(Buffer.from("LGTM")); // Codex

		const result = await new ReviewOrchestrator().review(42);
		expect(result.passed).toBe(true);
	});

	it("labels issues with reviewer name", async () => {
		vi.mocked(execSync)
			.mockReturnValueOnce(Buffer.from(DIFF))
			.mockReturnValueOnce(Buffer.from("CRITICAL: memory leak")) // Claude
			.mockReturnValueOnce(Buffer.from("LGTM")) // Gemini
			.mockReturnValueOnce(Buffer.from("CRITICAL: unsafe eval")) // Copilot
			.mockReturnValueOnce(Buffer.from("LGTM")); // Codex

		const result = await new ReviewOrchestrator().review(42);
		expect(result.criticalIssues).toHaveLength(2);
		expect(result.criticalIssues[0]).toMatch(/^\[Claude\]/);
		expect(result.criticalIssues[1]).toMatch(/^\[Copilot\]/);
	});
});
