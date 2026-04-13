import { execSync, spawnSync } from "node:child_process";
import type { CIResult } from "./types.js";

export class CIRunner {
	runLocal(worktreePath: string): CIResult {
		// Run tests scoped to the orchestrator package to avoid cross-package dependency issues
		// in nested worktrees where node_modules hoisting may not work for all packages.
		const pkgPath = `${worktreePath}/packages/orchestrator`;
		const testResult = spawnSync("bun", ["run", "test"], {
			cwd: pkgPath,
			stdio: "pipe",
			timeout: 5 * 60 * 1000,
		});

		if (testResult.status !== 0) {
			return {
				passed: false,
				failedChecks: ["bun run test"],
				errorOutput: (testResult.stderr?.toString() ?? "") + (testResult.stdout?.toString() ?? ""),
			};
		}

		return { passed: true, failedChecks: [], errorOutput: "" };
	}

	async runCloud(branch: string): Promise<CIResult> {
		try {
			// --watch waits for checks to complete; --json is incompatible with --watch
			// so we wait first, then fetch results separately
			execSync(`gh pr checks "${branch}" --watch --interval 30`, {
				stdio: "pipe",
				timeout: 20 * 60 * 1000,
			});

			const raw = execSync(`gh pr checks "${branch}" --json name,state`, {
				stdio: "pipe",
				timeout: 30_000,
			}).toString();

			const checks: Array<{ name: string; state: string }> = JSON.parse(raw);
			const failed = checks.filter((c) => c.state === "FAILURE" || c.state === "failure");

			return {
				passed: failed.length === 0,
				failedChecks: failed.map((c) => c.name),
				errorOutput: failed.length > 0 ? JSON.stringify(failed, null, 2) : "",
			};
		} catch (e) {
			const msg = (e as Error).message;
			// No CI configured or no PR yet — treat as passed
			if (msg.includes("no checks reported") || msg.includes("no checks") || msg.includes("no pull request")) {
				console.log(`[CI] No cloud checks for ${branch} — skipping`);
				return { passed: true, failedChecks: [], errorOutput: "" };
			}
			return {
				passed: false,
				failedChecks: ["gh pr checks"],
				errorOutput: msg,
			};
		}
	}
}
