import { execSync } from "node:child_process";
import type { FailureContext } from "./types.js";

const MAX_CI_OUTPUT = 3_000;

export class FailureExtractor {
	async extract(ciErrorOutput: string, worktreePath?: string): Promise<FailureContext> {
		const truncated = ciErrorOutput.slice(0, MAX_CI_OUTPUT);

		let gitContext = "";
		if (worktreePath) {
			try {
				const commitMsg = execSync("git log -1 --format=%s", {
					cwd: worktreePath,
					stdio: "pipe",
				})
					.toString()
					.trim();
				const changedFiles = execSync("git diff HEAD~1 HEAD --name-only 2>/dev/null || true", {
					cwd: worktreePath,
					stdio: "pipe",
				})
					.toString()
					.trim();
				if (commitMsg) {
					gitContext = `\n\nAgent's last commit message: "${commitMsg}"`;
					if (changedFiles) gitContext += `\nFiles changed: ${changedFiles}`;
				}
			} catch {
				/* no commits yet — leave gitContext empty */
			}
		}

		try {
			const prompt = `Extract the root cause of this CI failure. Be concise. Output ONLY valid JSON matching this schema:
{ "summary": "2-3 sentence root cause", "failedTests": ["test name 1"], "approach": "what the previous implementation tried (infer from commit message and files changed)" }

CI output:
${truncated}${gitContext}`;

			const out = execSync(
				`claude -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model claude-haiku-4-5-20251001`,
				{ stdio: "pipe", timeout: 30_000 },
			).toString();

			const jsonMatch = out.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error("No JSON in response");

			return JSON.parse(jsonMatch[0]) as FailureContext;
		} catch {
			return {
				summary: truncated.slice(0, 500),
				failedTests: [],
				approach: "unknown",
			};
		}
	}
}
