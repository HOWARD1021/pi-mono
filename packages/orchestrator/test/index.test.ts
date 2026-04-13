import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", () => ({
	AgentRunner: vi.fn().mockImplementation(() => ({
		run: vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" }),
	})),
}));
vi.mock("../src/ci-runner.js", () => ({
	CIRunner: vi.fn().mockImplementation(() => ({
		runLocal: vi.fn().mockReturnValue({ passed: true, failedChecks: [], errorOutput: "" }),
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
const mockGetRunning = vi.fn().mockResolvedValue([]);
vi.mock("../src/task-registry.js", () => ({
	TaskRegistry: vi.fn().mockImplementation(() => ({
		set: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue(null),
		getRunning: mockGetRunning,
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

import { runEvalSpec, runTaskWithRetry } from "../src/index.js";

const mockTask = {
	id: "task-1",
	title: "Backend API",
	description: "Build the API",
	model: "claude-opus-4-6",
	runner: "claude" as const,
	maxRetries: 3,
	requiresScreenshots: false,
	dependsOn: [],
};

const mockTaskWithFallback = {
	...mockTask,
	model: "gpt-5-mini",
	runner: "copilot" as const,
	fallbackModel: "claude-sonnet-4-6",
	fallbackRunner: "claude" as const,
	maxRetries: 2,
};

describe("runEvalSpec", () => {
	it("routes to EvalLoop when spec has eval field", async () => {
		// EvalLoop is fully mocked via the existing mocks (AgentRunner, WorktreeManager, ScoreRegistry)
		vi.mock("../src/eval-loop.js", () => ({
			EvalLoop: vi.fn().mockImplementation(() => ({
				run: vi.fn().mockResolvedValue({
					reachedTarget: true,
					bestScore: 92,
					bestCommitSha: "abc1234",
					generations: 2,
					history: [],
				}),
			})),
		}));
		vi.mock("../src/eval-runner.js", () => ({
			CodeEvalRunner: vi.fn().mockImplementation(() => ({ run: vi.fn() })),
		}));

		const evalSpec = {
			feature: "Improve coverage",
			contextFiles: [],
			tasks: [mockTask],
			eval: { type: "track-a" as const, runner: "code-coverage", target: 85, maxGenerations: 2 },
		};

		const result = await runEvalSpec(evalSpec, "main");
		expect(result.reachedTarget).toBe(true);
		expect(result.bestScore).toBe(92);
	});
});

describe("runTaskWithRetry", () => {
	it("returns success=true when agent + CI + review all pass on first attempt", async () => {
		const result = await runTaskWithRetry(mockTask, [], "main");
		expect(result.success).toBe(true);
	});

	it("seeds attemptHistory from initialAttemptHistory (Gap C recovery)", async () => {
		const seedHistory = ["Attempt 1 (error): network timeout"];
		const result = await runTaskWithRetry(mockTask, [], "main", undefined, seedHistory);
		expect(result.success).toBe(true);
		// On a clean first attempt the seeded history is preserved in the result
		expect(result.attemptHistory).toEqual(seedHistory);
	});

	it("uses fallback model+runner on attempt 2 when review fails on attempt 1", async () => {
		const { AgentRunner } = await import("../src/agent-runner.js");
		const { ReviewOrchestrator } = await import("../src/review-orchestrator.js");

		vi.mocked(AgentRunner).mockClear();
		const runSpy = vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" });
		vi.mocked(AgentRunner).mockImplementation(
			(_, runner) => ({ run: runSpy, _runner: runner }) as unknown as InstanceType<typeof AgentRunner>,
		);

		// Fail review on attempt 1, pass on attempt 2
		vi.mocked(ReviewOrchestrator).mockImplementationOnce(() => ({
			review: vi
				.fn()
				.mockResolvedValueOnce({ passed: false, criticalIssues: ["CRITICAL: prototype pollution"] })
				.mockResolvedValue({ passed: true, criticalIssues: [] }),
		}));

		await runTaskWithRetry(mockTaskWithFallback, [], "main");

		// AgentRunner is constructed twice (attempt 1 + attempt 2)
		const calls = vi.mocked(AgentRunner).mock.calls;
		expect(calls).toHaveLength(2);
		// attempt 1 → copilot
		expect(calls[0][1]).toBe("copilot");
		// attempt 2 → claude (fallback)
		expect(calls[1][1]).toBe("claude");

		// run() model arg also escalates
		expect(runSpy.mock.calls[0][1]).toBe("gpt-5-mini");
		expect(runSpy.mock.calls[1][1]).toBe("claude-sonnet-4-6");
	});

	it("uses primary model on all attempts when no fallback declared", async () => {
		const { AgentRunner } = await import("../src/agent-runner.js");
		const runSpy = vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" });
		vi.mocked(AgentRunner).mockImplementation(() => ({ run: runSpy }) as unknown as InstanceType<typeof AgentRunner>);

		await runTaskWithRetry(mockTask, [], "main");

		// Only one attempt needed (all pass), but model should be the primary
		expect(runSpy.mock.calls[0][1]).toBe("claude-opus-4-6");
	});

	it("passes baseSha (wt.baseCommitSha) to agentRunner.run() (Gap A)", async () => {
		const { AgentRunner } = await import("../src/agent-runner.js");
		const runSpy = vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" });
		vi.mocked(AgentRunner).mockImplementationOnce(
			() => ({ run: runSpy, worktreePath: "", getHeadSha: vi.fn() }) as unknown as InstanceType<typeof AgentRunner>,
		);

		await runTaskWithRetry(mockTask, [], "main");

		// wt.baseCommitSha is "base123" (from WorktreeManager mock above)
		expect(runSpy).toHaveBeenCalledWith(
			expect.any(String), // prompt
			expect.any(String), // model
			undefined, // timeoutMs (default)
			"base123", // baseSha ← this is what Gap A wires in
		);
	});
});
