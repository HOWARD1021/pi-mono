import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
	spawnSync: vi.fn(),
}));

import { execSync, spawnSync } from "node:child_process";
import { CIRunner } from "../src/ci-runner.js";

describe("CIRunner", () => {
	it("runLocal passes when bun run test succeeds", () => {
		vi.mocked(spawnSync).mockReturnValueOnce({
			status: 0,
			stdout: Buffer.from(""),
			stderr: null,
		} as any);

		const runner = new CIRunner();
		const result = runner.runLocal("/tmp/worktree");
		expect(result.passed).toBe(true);
	});

	it("runLocal fails when bun run test exits non-zero", () => {
		vi.mocked(spawnSync).mockReturnValueOnce({
			status: 1,
			stdout: Buffer.from(""),
			stderr: Buffer.from("2 tests failed"),
		} as any);

		const runner = new CIRunner();
		const result = runner.runLocal("/tmp/worktree");
		expect(result.passed).toBe(false);
		expect(result.failedChecks).toContain("bun run test");
		expect(result.errorOutput).toContain("2 tests failed");
	});

	it("runCloud parses gh pr checks output", async () => {
		vi.mocked(execSync).mockReturnValue(Buffer.from(JSON.stringify([{ name: "CI", state: "SUCCESS" }])));

		const runner = new CIRunner();
		const result = await runner.runCloud("my-branch");
		expect(result.passed).toBe(true);
	});

	it("runCloud treats no checks as passed", async () => {
		const err = new Error("no checks reported on the 'my-branch' branch");
		vi.mocked(execSync).mockImplementationOnce(() => {
			throw err;
		});

		const runner = new CIRunner();
		const result = await runner.runCloud("my-branch");
		expect(result.passed).toBe(true);
	});
});
