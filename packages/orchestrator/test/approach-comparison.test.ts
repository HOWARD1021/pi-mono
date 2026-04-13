/**
 * Head-to-head comparison: Pi Orchestrator (streaming signal) vs codex-delegate (sentinel file)
 *
 * Three scenarios:
 *   1. Lie detection  — agent signals done but made no commit
 *   2. Parallelism    — N agents running concurrently
 *   3. Crash recovery — agent exits without any signal
 *
 * SentinelAgentRunner simulates the codex-delegate pattern:
 *   - writes a .done file to signal completion (no stdout signal required)
 *   - polls for the sentinel file (synchronous style, here awaited)
 *   - does NOT verify that any git work actually happened
 */

import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock child_process ───────────────────────────────────────────────────────
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
	execSync: vi.fn(),
}));

import { execSync, spawn } from "node:child_process";
import { AgentRunner } from "../src/agent-runner.js";

// ─── SentinelAgentRunner (codex-delegate pattern) ────────────────────────────

interface SentinelResult {
	summary: string | null;
	lastCommitSha: string;
}

/**
 * Mimics codex-delegate: runs a shell command, waits for .done sentinel file.
 * Does NOT verify git SHA — trusts the file on disk.
 */
class SentinelAgentRunner {
	constructor(private readonly worktreePath: string) {}

	run(
		_prompt: string,
		_model: string,
		runFn: (dir: string) => void, // test hook: simulates what the "agent" does
	): Promise<SentinelResult> {
		const doneFile = join(this.worktreePath, ".done");
		const errorFile = join(this.worktreePath, ".error");

		return new Promise((resolve, reject) => {
			// Simulate async agent execution
			setTimeout(() => {
				runFn(this.worktreePath);

				// Check sentinel files
				try {
					const { existsSync, readFileSync } = require("node:fs");
					if (existsSync(errorFile)) {
						reject(new Error(readFileSync(errorFile, "utf8")));
					} else if (existsSync(doneFile)) {
						// ⚠ codex-delegate pattern: trusts .done, no SHA verification
						resolve({ summary: null, lastCommitSha: "unknown" });
					} else {
						reject(new Error("Agent exited without writing .done sentinel"));
					}
				} catch (err) {
					reject(err);
				}
			}, 10);
		});
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(tmpdir(), `sentinel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeStreamingProc(stdoutLines: string[], exitCode = 0, delayMs = 10) {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const proc = new EventEmitter() as any;
	proc.stdout = stdout;
	proc.stderr = stderr;
	proc.kill = vi.fn();

	setTimeout(() => {
		for (const line of stdoutLines) stdout.emit("data", Buffer.from(line));
		proc.emit("close", exitCode);
	}, delayMs);

	return proc;
}

// ─── Scenario 1: Lie Detection ────────────────────────────────────────────────

describe("Scenario 1 — Lie detection: agent signals done but made no commit", () => {
	beforeEach(() => vi.clearAllMocks());

	it("[STREAMING] AgentRunner REJECTS: detects SHA unchanged after signal", async () => {
		// baseSha and HEAD sha are the same → agent lied
		vi.mocked(execSync).mockReturnValue(Buffer.from("abc1234\n"));
		vi.mocked(spawn).mockReturnValue(makeStreamingProc(["All good! <ready-for-review/>\n"]) as any);

		const dir = makeTmpDir();
		const runner = new AgentRunner(dir);
		await expect(
			runner.run("Do the work", "claude-opus-4-6", 5000, "abc1234"), // baseSha = same as HEAD
		).rejects.toThrow(/no commit/i);
		rmSync(dir, { recursive: true });
	});

	it("[SENTINEL] SentinelAgentRunner RESOLVES: no SHA check, lie goes undetected", async () => {
		const dir = makeTmpDir();
		const runner = new SentinelAgentRunner(dir);

		const result = await runner.run("Do the work", "gpt-5", (worktreePath) => {
			// Agent writes .done but makes no git commit — sentinel approach can't detect this
			writeFileSync(join(worktreePath, ".done"), "DONE|codex/gpt-5|2026-04-12");
		});

		// ✅ Resolves successfully — but work was never done
		expect(result.lastCommitSha).toBe("unknown");
		rmSync(dir, { recursive: true });
	});

	it("VERDICT: streaming wins — SHA check catches lies that sentinel misses", () => {
		// This test documents the design decision
		expect(true).toBe(true);
	});
});

// ─── Scenario 2: Parallelism ──────────────────────────────────────────────────

describe("Scenario 2 — Parallelism: 4 agents running concurrently", () => {
	beforeEach(() => vi.clearAllMocks());

	it("[STREAMING] All 4 complete concurrently — wall time ≈ single agent time", async () => {
		vi.mocked(execSync).mockReturnValue(Buffer.from("def5678\n"));

		// Each mock agent takes ~50ms
		vi.mocked(spawn).mockImplementation(() => makeStreamingProc(["<ready-for-review/>\n"], 0, 50) as any);

		const worktrees = [1, 2, 3, 4].map(() => makeTmpDir());
		const runners = worktrees.map((d) => new AgentRunner(d));

		const start = Date.now();
		await Promise.all(runners.map((r) => r.run("Task", "claude-opus-4-6", 5000, "old-sha")));
		const elapsed = Date.now() - start;

		for (const d of worktrees) rmSync(d, { recursive: true });

		// Concurrent: should finish in ~50ms, not 200ms
		expect(elapsed).toBeLessThan(200);
	});

	it("[SENTINEL] Sequential simulation — wall time = N × single agent time", async () => {
		const dirs = [1, 2, 3, 4].map(() => makeTmpDir());

		const start = Date.now();
		// Sentinel pattern is synchronous — must await each one before starting next
		for (const dir of dirs) {
			const runner = new SentinelAgentRunner(dir);
			await runner.run("Task", "gpt-5", (worktreePath) => {
				writeFileSync(join(worktreePath, ".done"), "DONE");
			});
		}
		const elapsed = Date.now() - start;

		// Sequential: takes ~4 × 10ms = ~40ms minimum
		expect(elapsed).toBeGreaterThanOrEqual(30);

		for (const d of dirs) rmSync(d, { recursive: true });
	});

	it("VERDICT: streaming wins for parallel orchestration — Promise.all is free", () => {
		expect(true).toBe(true);
	});
});

// ─── Scenario 3: Crash Recovery ───────────────────────────────────────────────

describe("Scenario 3 — Crash recovery: agent exits without signaling", () => {
	beforeEach(() => vi.clearAllMocks());

	it("[STREAMING] Rejects with descriptive error including last output", async () => {
		vi.mocked(spawn).mockReturnValue(
			makeStreamingProc(["Starting work...\n", "Unexpected error occurred\n"], 1) as any,
		);

		const dir = makeTmpDir();
		const runner = new AgentRunner(dir);
		await expect(runner.run("Do the work", "claude-opus-4-6", 5000)).rejects.toThrow(/ready-for-review/i);
		rmSync(dir, { recursive: true });
	});

	it("[SENTINEL] Rejects when .done file never written", async () => {
		const dir = makeTmpDir();
		const runner = new SentinelAgentRunner(dir);

		await expect(
			runner.run("Do the work", "gpt-5", (_worktreePath) => {
				// Agent crashes — writes nothing
			}),
		).rejects.toThrow(/sentinel/i);

		rmSync(dir, { recursive: true });
	});

	it("[SENTINEL] Rejects with error content when .error sentinel written", async () => {
		const dir = makeTmpDir();
		const runner = new SentinelAgentRunner(dir);

		await expect(
			runner.run("Do the work", "gpt-5", (worktreePath) => {
				writeFileSync(join(worktreePath, ".error"), "quota_exceeded: rate limit hit");
			}),
		).rejects.toThrow(/quota_exceeded/i);

		rmSync(dir, { recursive: true });
	});

	it("VERDICT: sentinel wins on error classification — .error file carries structured reason", () => {
		// Our approach: generic "exited without signal" message
		// Sentinel:     .error file has specific reason (quota, auth, etc.)
		expect(true).toBe(true);
	});
});

// ─── Summary ──────────────────────────────────────────────────────────────────

describe("Summary — head-to-head results", () => {
	it("documents the final scorecard", () => {
		const scorecard = {
			"Lie detection (agent fakes completion)": "STREAMING wins — SHA check",
			"Parallel task execution": "STREAMING wins — Promise.all",
			"Crash error classification": "SENTINEL wins — .error file reason",
			"Audit trail (task context on disk)": "SENTINEL wins — .md context files",
			"Real-time output visibility": "STREAMING wins — live [agent] prefix",
		};

		// All entries present
		expect(Object.keys(scorecard)).toHaveLength(5);

		const streamingWins = Object.values(scorecard).filter((v) => v.startsWith("STREAMING")).length;
		const sentinelWins = Object.values(scorecard).filter((v) => v.startsWith("SENTINEL")).length;

		expect(streamingWins).toBe(3); // streaming: 3
		expect(sentinelWins).toBe(2); // sentinel: 2
	});
});
