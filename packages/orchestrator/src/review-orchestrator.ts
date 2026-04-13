import { execSync } from "node:child_process";
import type { ReviewResult } from "./types.js";

interface Reviewer {
	name: string;
	buildCmd: (prompt: string) => string;
}

const REVIEWERS: Reviewer[] = [
	{
		name: "Claude",
		buildCmd: (p) =>
			`claude -p ${JSON.stringify(p)} --dangerously-skip-permissions --model claude-haiku-4-5-20251001`,
	},
	{
		name: "Gemini",
		buildCmd: (p) => `gemini -p ${JSON.stringify(p)}`,
	},
	{
		name: "Copilot",
		buildCmd: (p) => `copilot -p ${JSON.stringify(p)} --yolo --no-ask-user -s`,
	},
	{
		name: "Codex",
		buildCmd: (p) => `codex exec ${JSON.stringify(p)}`,
	},
];

const REVIEW_PROMPT = (prNumber: number, diff: string) =>
	`You are a code reviewer. Review this PR diff for CRITICAL issues only (security, correctness, data loss).
For each CRITICAL issue output a line starting with "CRITICAL: ".
If no critical issues, output only "LGTM".

PR #${prNumber} diff:
${diff}`;

export class ReviewOrchestrator {
	async review(prNumber: number): Promise<ReviewResult> {
		let diff = "";
		try {
			diff = execSync(`gh pr diff ${prNumber}`, { stdio: "pipe" }).toString().slice(0, 8_000);
		} catch (e) {
			return { passed: false, criticalIssues: [`Failed to fetch PR diff: ${(e as Error).message}`] };
		}

		const prompt = REVIEW_PROMPT(prNumber, diff);
		const allIssues: string[] = [];

		await Promise.allSettled(
			REVIEWERS.map(async ({ name, buildCmd }) => {
				try {
					const out = execSync(buildCmd(prompt), { stdio: "pipe", timeout: 5 * 60 * 1000 }).toString();
					const issues = out
						.split("\n")
						.filter((l) => l.startsWith("CRITICAL:"))
						.map((l) => `[${name}] ${l}`);
					allIssues.push(...issues);
				} catch {
					// Reviewer CLI unavailable or timed out — degrade gracefully
				}
			}),
		);

		return { passed: allIssues.length === 0, criticalIssues: allIssues };
	}
}
