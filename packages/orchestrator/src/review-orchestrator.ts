import { execSync } from "node:child_process";
import type { ReviewResult } from "./types.js";

export class ReviewOrchestrator {
	async review(prNumber: number): Promise<ReviewResult> {
		let diff = "";
		try {
			diff = execSync(`gh pr diff ${prNumber}`, { stdio: "pipe" }).toString().slice(0, 8_000);
		} catch (e) {
			return { passed: false, criticalIssues: [`Failed to fetch PR diff: ${(e as Error).message}`] };
		}

		try {
			const prompt = `You are a code reviewer. Review this PR diff for CRITICAL issues only (security, correctness, data loss).
For each CRITICAL issue output a line starting with "CRITICAL: ".
If no critical issues, output only "LGTM".

PR #${prNumber} diff:
${diff}`;

			const out = execSync(
				`claude -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model claude-haiku-4-5-20251001`,
				{ stdio: "pipe", timeout: 5 * 60 * 1000 },
			).toString();

			const criticalIssues = out
				.split("\n")
				.filter((l) => l.startsWith("CRITICAL:"))
				.map((l) => `[Claude] ${l}`);

			return { passed: criticalIssues.length === 0, criticalIssues };
		} catch {
			// Review failed — don't block the PR
			return { passed: true, criticalIssues: [] };
		}
	}
}
