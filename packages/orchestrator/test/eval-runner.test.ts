import { describe, expect, it, vi } from "vitest";

// CodeEvalRunner executes `bun run test --coverage` inside the worktree and
// parses the coverage percentage out of the output.
// We mock execSync so the test never touches the filesystem.
vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { CodeEvalRunner } from "../src/eval-runner.js";

describe("CodeEvalRunner", () => {
	it("returns coverage % as score when all tests pass", () => {
		vi.mocked(execSync).mockReturnValue(
			Buffer.from(`
All files | 82.14 | 75.00 | 90.00 | 82.14 |
`) as unknown as ReturnType<typeof execSync>,
		);

		const runner = new CodeEvalRunner();
		const result = runner.run("/wt/task-1");

		expect(result.score).toBeCloseTo(82.14);
		expect(result.details).toContain("82.14");
	});

	it("returns score 0 and details containing error when tests fail", () => {
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("Tests failed:\n1 failing");
		});

		const runner = new CodeEvalRunner();
		const result = runner.run("/wt/task-1");

		expect(result.score).toBe(0);
		expect(result.details).toContain("Tests failed");
	});

	it("returns score 0 when coverage line is not found", () => {
		vi.mocked(execSync).mockReturnValue(
			Buffer.from("no coverage output here") as unknown as ReturnType<typeof execSync>,
		);

		const runner = new CodeEvalRunner();
		const result = runner.run("/wt/task-1");

		expect(result.score).toBe(0);
		expect(result.details).toContain("coverage not found");
	});

	it("appends packageSubdir to worktreePath as cwd", () => {
		const execMock = vi.mocked(execSync);
		execMock.mockReturnValue(Buffer.from("All files | 90.00 |") as unknown as ReturnType<typeof execSync>);

		const runner = new CodeEvalRunner(); // default: "packages/orchestrator"
		runner.run("/wt/root");

		expect(execMock).toHaveBeenCalledWith(
			expect.stringContaining("bun run test"),
			expect.objectContaining({ cwd: "/wt/root/packages/orchestrator" }),
		);
	});

	it("uses worktreePath directly when packageSubdir is empty string", () => {
		const execMock = vi.mocked(execSync);
		execMock.mockReturnValue(Buffer.from("All files | 90.00 |") as unknown as ReturnType<typeof execSync>);

		const runner = new CodeEvalRunner(""); // no subdir
		runner.run("/standalone/pkg");

		expect(execMock).toHaveBeenCalledWith(
			expect.stringContaining("bun run test"),
			expect.objectContaining({ cwd: "/standalone/pkg" }),
		);
	});
});
