import { describe, expect, it, vi } from "vitest";
import type { EvalResult, EvalSpec } from "../src/types.js";

// Mock heavy deps
vi.mock("../src/agent-runner.js", () => ({
	AgentRunner: vi.fn().mockImplementation(() => ({
		run: vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "sha-new" }),
	})),
}));
vi.mock("../src/worktree-manager.js", () => ({
	WorktreeManager: vi.fn().mockImplementation(() => ({
		create: vi.fn().mockReturnValue({ path: "/wt/task-1", branch: "agent/task-1", baseCommitSha: "base123" }),
		remove: vi.fn(),
		reset: vi.fn(),
	})),
}));
vi.mock("../src/score-registry.js", () => ({
	ScoreRegistry: vi.fn().mockImplementation(() => ({
		get: vi.fn().mockResolvedValue(undefined),
		record: vi.fn().mockResolvedValue(undefined),
	})),
}));
vi.mock("node:child_process", () => ({
	execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

import { EvalLoop } from "../src/eval-loop.js";
import type { EvalRunner } from "../src/eval-runner.js";

function makeRunner(scores: number[]): EvalRunner {
	let i = 0;
	return {
		run: (_path: string): EvalResult => {
			const score = scores[i++] ?? scores[scores.length - 1];
			return { score, details: `score=${score}` };
		},
	};
}

const baseSpec: EvalSpec = {
	type: "track-a",
	runner: "code-coverage",
	target: 90,
	maxGenerations: 5,
};

const mockTask = {
	id: "task-1",
	title: "Improve coverage",
	description: "Add tests",
	model: "claude-opus-4-6",
	runner: "claude" as const,
	maxRetries: 3,
	requiresScreenshots: false,
	dependsOn: [],
};

describe("EvalLoop", () => {
	it("stops when score reaches target", async () => {
		const runner = makeRunner([70, 85, 92]); // gen 3 hits target 90
		const loop = new EvalLoop(baseSpec, runner);

		const result = await loop.run(mockTask, [], "main");

		expect(result.reachedTarget).toBe(true);
		expect(result.bestScore).toBeGreaterThanOrEqual(90);
		expect(result.generations).toBe(3);
	});

	it("stops at maxGenerations when target not reached", async () => {
		const runner = makeRunner([60, 65, 70, 75, 80]); // never hits 90
		const loop = new EvalLoop(baseSpec, runner);

		const result = await loop.run(mockTask, [], "main");

		expect(result.reachedTarget).toBe(false);
		expect(result.generations).toBe(5);
		expect(result.bestScore).toBe(80);
	});

	it("tracks best score across generations", async () => {
		const runner = makeRunner([70, 85, 75, 60]); // gen 2 is best
		const loop = new EvalLoop({ ...baseSpec, maxGenerations: 4 }, runner);

		const result = await loop.run(mockTask, [], "main");

		expect(result.bestScore).toBe(85);
	});

	it("records each generation in ScoreRegistry", async () => {
		const { ScoreRegistry } = await import("../src/score-registry.js");
		const recordSpy = vi.fn().mockResolvedValue(undefined);
		vi.mocked(ScoreRegistry).mockImplementationOnce(
			() =>
				({ get: vi.fn().mockResolvedValue(undefined), record: recordSpy }) as unknown as InstanceType<
					typeof ScoreRegistry
				>,
		);

		const runner = makeRunner([80, 95]); // gen 2 hits target
		const loop = new EvalLoop(baseSpec, runner);
		await loop.run(mockTask, [], "main");

		expect(recordSpy).toHaveBeenCalledTimes(2);
	});

	it("returns score history in result", async () => {
		const runner = makeRunner([70, 92]);
		const loop = new EvalLoop(baseSpec, runner);

		const result = await loop.run(mockTask, [], "main");

		expect(result.history).toHaveLength(2);
		expect(result.history[0].score).toBe(70);
		expect(result.history[1].score).toBe(92);
	});
});
