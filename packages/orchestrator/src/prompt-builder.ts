import type { ParsedTask, ScoreHistory } from "./types.js";

export function buildPrompt(
	task: ParsedTask,
	contextChunks: string,
	attemptHistory: string[],
	gitLog: string,
	scoreHistory?: ScoreHistory,
): string {
	const parts: string[] = [];

	if (gitLog) {
		parts.push(`## Your Git History on This Branch\n\n\`\`\`\n${gitLog}\n\`\`\``);
	}

	if (contextChunks) {
		parts.push(`## Business Context\n\n${contextChunks}`);
	}

	if (attemptHistory.length > 0) {
		const historyText = attemptHistory
			.map((h, i) => `### Attempt ${i + 1}\n${h}\n⚠️ Do NOT repeat this approach.`)
			.join("\n\n");
		parts.push(
			`## IMPORTANT: Previous Attempts Failed\n\n${historyText}\n\nYou MUST try a **different approach** than what was attempted before. Study the failure reasons carefully and change your implementation strategy.`,
		);
	}

	if (scoreHistory && scoreHistory.entries.length > 0) {
		const best = scoreHistory.bestScore;
		const bestGen = scoreHistory.entries.findIndex((e) => e.commitSha === scoreHistory.bestCommitSha) + 1;
		const last = scoreHistory.entries[scoreHistory.entries.length - 1];
		const lastStatus = last.kept ? "kept" : "dropped";
		const genLines = scoreHistory.entries
			.map((e) => `  gen ${e.generation}: ${e.score} → ${e.kept ? "keep" : "discard"}`)
			.join("\n");

		parts.push(
			`## Score History\n\nBest so far: ${best} / 100 (generation ${bestGen})\nLast attempt: ${last.score} / 100 — ${lastStatus}\n\nGeneration history:\n${genLines}\n\nYour goal: beat ${best}.\nWhat specifically could you change to improve the score?`,
		);
	}

	parts.push(`# Task: ${task.title}\n\n${task.description}`);

	const screenshotGate = task.requiresScreenshots
		? "\n4. Take before/after screenshots and include them in the PR description"
		: "";

	parts.push(`## Local Completion Gate

Before finishing:
1. Run \`cd packages/orchestrator && bun run test && cd ../..\` — ALL checks must pass
2. Run \`git add -A && git commit -m "feat: ${task.title}"\`${screenshotGate}
3. Print the exact token below as your LAST output — nothing after it

## ⚠️ MANDATORY FINAL OUTPUT

You MUST print this exact string as the very last thing you output.
Print it AFTER committing. Print NOTHING after it.
If you exit without printing it, the task is marked FAILED.

<ready-for-review/>`);

	return parts.join("\n\n---\n\n");
}
