import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/prompt-builder.js";
import type { ParsedTask, ScoreHistory } from "../src/types.js";

const task: ParsedTask = {
	id: "task-1",
	title: "Build API",
	model: "claude-opus-4-6",
	runner: "claude",
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
		expect(p).toContain("bun run test");
		expect(p).toContain("git commit");
	});

	it("includes attempt history on retry", () => {
		const history = ["Attempt 1 failed: TypeError in src/api.ts at line 42"];
		const p = buildPrompt(task, "", history, "");
		expect(p).toContain("Previous Attempts");
		expect(p).toContain("TypeError");
		expect(p).toContain("different approach");
		expect(p).toContain("Do NOT repeat this approach");
	});

	it("includes approach-aware failure context in retry prompt", () => {
		const history = [
			"Attempt 1 (local CI failed):\nApproach tried: direct string replace\nRoot cause: off-by-one error\nFailed tests: test-foo",
		];
		const p = buildPrompt(task, "", history, "");
		expect(p).toContain("Approach tried: direct string replace");
		expect(p).toContain("Root cause: off-by-one error");
		expect(p).toContain("Do NOT repeat this approach");
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

	it("mandatory final output section appears AFTER gate steps", () => {
		const p = buildPrompt(task, "", [], "");
		const gateIdx = p.indexOf("Local Completion Gate");
		const mandatoryIdx = p.indexOf("MANDATORY FINAL OUTPUT");
		expect(mandatoryIdx).toBeGreaterThan(gateIdx);
		expect(p).toContain("LAST output");
		expect(p).toContain("marked FAILED");
	});
});

describe("PromptBuilder — score history", () => {
	const scoreHistory: ScoreHistory = {
		taskId: "task-1",
		bestScore: 72,
		bestCommitSha: "abc1234",
		entries: [
			{ generation: 1, score: 51, commitSha: "sha1", kept: false },
			{ generation: 2, score: 63, commitSha: "sha2", kept: true },
			{ generation: 3, score: 72, commitSha: "abc1234", kept: true },
			{ generation: 4, score: 68, commitSha: "sha4", kept: false },
		],
	};

	it("includes Score History section when scoreHistory provided", () => {
		const p = buildPrompt(task, "", [], "", scoreHistory);
		expect(p).toContain("Score History");
	});

	it("shows best score and which generation it came from", () => {
		const p = buildPrompt(task, "", [], "", scoreHistory);
		expect(p).toContain("72");
		expect(p).toContain("generation 3");
	});

	it("shows last attempt score and kept/dropped status", () => {
		const p = buildPrompt(task, "", [], "", scoreHistory);
		expect(p).toContain("68");
		expect(p).toMatch(/dropped|discard/i);
	});

	it("lists all generation entries", () => {
		const p = buildPrompt(task, "", [], "", scoreHistory);
		expect(p).toContain("gen 1");
		expect(p).toContain("gen 2");
		expect(p).toContain("gen 3");
		expect(p).toContain("gen 4");
	});

	it("includes beat-the-best prompt nudge", () => {
		const p = buildPrompt(task, "", [], "", scoreHistory);
		expect(p).toMatch(/beat|improve|exceed/i);
		expect(p).toContain("72");
	});

	it("omits Score History section when scoreHistory is not provided", () => {
		const p = buildPrompt(task, "", [], "");
		expect(p).not.toContain("Score History");
	});
});
