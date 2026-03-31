import { execSync, spawnSync } from "node:child_process";
import type { CIResult } from "./types.js";

export class CIRunner {
  runLocal(worktreePath: string): CIResult {
    const testResult = spawnSync("bun", ["test"], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 5 * 60 * 1000,
    });

    if (testResult.status !== 0) {
      return {
        passed: false,
        failedChecks: ["bun test"],
        errorOutput: (testResult.stderr?.toString() ?? "") + (testResult.stdout?.toString() ?? ""),
      };
    }

    const tscResult = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 2 * 60 * 1000,
    });

    if (tscResult.status !== 0) {
      return {
        passed: false,
        failedChecks: ["tsc --noEmit"],
        errorOutput: tscResult.stdout?.toString() ?? "",
      };
    }

    return { passed: true, failedChecks: [], errorOutput: "" };
  }

  async runCloud(branch: string): Promise<CIResult> {
    try {
      const raw = execSync(
        `gh pr checks --json name,status,conclusion --watch --interval 30`,
        { stdio: "pipe", timeout: 20 * 60 * 1000 }
      ).toString();

      const checks: Array<{ name: string; conclusion: string }> = JSON.parse(raw);
      const failed = checks.filter((c) => c.conclusion === "failure");

      return {
        passed: failed.length === 0,
        failedChecks: failed.map((c) => c.name),
        errorOutput: failed.length > 0 ? JSON.stringify(failed, null, 2) : "",
      };
    } catch (e) {
      return {
        passed: false,
        failedChecks: ["gh pr checks"],
        errorOutput: (e as Error).message,
      };
    }
  }
}
