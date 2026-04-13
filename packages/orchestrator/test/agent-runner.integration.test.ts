import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

// Mock child_process before importing module under test
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
	execSync: vi.fn().mockReturnValue(Buffer.from("abc1234\n")),
}));

// Mock fs so tests don't need real worktree paths on disk
vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
	readdirSync: vi.fn().mockReturnValue([]),
	readFileSync: vi.fn().mockReturnValue(""),
}));

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { AgentRunner } from "../src/agent-runner.js";

const REF_PROMPT = "Read .agent-context/task.md and execute all instructions inside.";

function makeProc(stdoutLines: string[], exitCode = 0) {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const proc = new EventEmitter() as any;
	proc.stdout = stdout;
	proc.stderr = stderr;
	proc.kill = vi.fn();

	// Emit stdout lines async, then close
	setTimeout(() => {
		for (const line of stdoutLines) {
			stdout.emit("data", Buffer.from(line));
		}
		proc.emit("close", exitCode);
	}, 10);

	return proc;
}

describe("AgentRunner", () => {
	it("resolves when <ready-for-review/> appears in stdout", async () => {
		vi.mocked(spawn).mockReturnValue(makeProc(["Working on it...\n", "All done. <ready-for-review/>\n"]) as any);

		const runner = new AgentRunner("/wt/task-1");
		const result = await runner.run("Do the work", "claude-opus-4-6", 5000);

		expect(result.lastCommitSha).toBe("abc1234");
		// Context file pattern: original prompt written to disk, ref prompt passed to CLI
		expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith("/wt/task-1/.agent-context/task.md", "Do the work", "utf8");
		expect(spawn).toHaveBeenCalledWith(
			"claude",
			expect.arrayContaining(["-p", REF_PROMPT]),
			expect.objectContaining({ cwd: "/wt/task-1" }),
		);
	});

	it("rejects on timeout when signal never appears", async () => {
		vi.mocked(spawn).mockReturnValue(makeProc([]) as any); // exits with no signal

		const runner = new AgentRunner("/wt/task-1");
		await expect(runner.run("Do the work", "claude-opus-4-6", 50)).rejects.toThrow(/timeout|ready-for-review/i);
	});

	it("spawns copilot with --autopilot flags when backend is copilot", async () => {
		vi.mocked(spawn).mockReturnValue(makeProc(["Done! <ready-for-review/>\n"]) as any);

		const runner = new AgentRunner("/wt/task-1", "copilot");
		await runner.run("Do the work", "gpt-5-mini", 5000);

		expect(spawn).toHaveBeenCalledWith(
			"copilot",
			expect.arrayContaining(["-p", REF_PROMPT, "--autopilot", "--no-ask-user", "--yolo", "-s"]),
			expect.objectContaining({ cwd: "/wt/task-1" }),
		);
	});

	it("spawns claude with --dangerously-skip-permissions when backend is claude (default)", async () => {
		vi.mocked(spawn).mockReturnValue(makeProc(["<ready-for-review/>\n"]) as any);

		const runner = new AgentRunner("/wt/task-1");
		await runner.run("Do the work", "claude-opus-4-6", 5000);

		expect(spawn).toHaveBeenCalledWith(
			"claude",
			expect.arrayContaining(["-p", REF_PROMPT, "--dangerously-skip-permissions"]),
			expect.objectContaining({ cwd: "/wt/task-1" }),
		);
	});
});
