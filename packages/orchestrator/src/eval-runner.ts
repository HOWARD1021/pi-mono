import { execSync } from "node:child_process";
import { join } from "node:path";
import type { EvalResult } from "./types.js";

export interface EvalRunner {
	run(worktreePath: string): EvalResult;
}

export class CodeEvalRunner implements EvalRunner {
	/**
	 * @param packageSubdir - relative path from worktree root to the package
	 *   that owns `bun run test`. Defaults to "packages/orchestrator" to match
	 *   the monorepo layout. Pass "" to run from worktreePath directly.
	 */
	constructor(private readonly packageSubdir = "packages/orchestrator") {}

	run(worktreePath: string): EvalResult {
		const cwd = this.packageSubdir ? join(worktreePath, this.packageSubdir) : worktreePath;
		let output: string;
		try {
			output = execSync("bun run test --coverage 2>&1", {
				cwd,
				stdio: "pipe",
			}).toString();
		} catch (e) {
			const msg = (e as Error).message;
			return { score: 0, details: msg };
		}

		// Parse the summary row: "All files | 82.14 | ..."
		const match = output.match(/All files\s*\|\s*([\d.]+)/);
		if (!match) {
			return { score: 0, details: "coverage not found in output" };
		}

		const score = parseFloat(match[1]);
		return { score, details: `Coverage: ${score}%\n${output.slice(0, 500)}` };
	}
}

export class SkillEvalRunner implements EvalRunner {
	constructor(
		readonly _rubric: Record<string, number>, // criterion → weight
	) {}

	run(_worktreePath: string): EvalResult {
		// Placeholder — Track B requires LLM-as-judge call (implemented separately)
		throw new Error("SkillEvalRunner.run() not yet implemented");
	}
}
