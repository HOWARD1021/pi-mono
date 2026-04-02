import type { ParsedTask } from "./types.js";

export function buildPrompt(
  task: ParsedTask,
  contextChunks: string,
  attemptHistory: string[],
  gitLog: string
): string {
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}\n\n${task.description}`);

  if (contextChunks) {
    parts.push(`## Business Context\n\n${contextChunks}`);
  }

  if (gitLog) {
    parts.push(`## Your Git History on This Branch\n\n\`\`\`\n${gitLog}\n\`\`\``);
  }

  if (attemptHistory.length > 0) {
    const historyText = attemptHistory
      .map((h, i) => `### Attempt ${i + 1}\n${h}`)
      .join("\n\n");
    parts.push(
      `## IMPORTANT: Previous Attempts Failed\n\n${historyText}\n\nYou MUST try a **different approach** than what was attempted before. Study the failure reasons carefully and change your implementation strategy.`
    );
  }

  const screenshotGate = task.requiresScreenshots
    ? "\n4. Take before/after screenshots and include them in the PR description"
    : "";

  parts.push(`## Local Completion Gate

Before finishing:
1. Run \`cd packages/orchestrator && bun run test && cd ../..\` — ALL checks must pass
2. Run \`git add -A && git commit -m "feat: ${task.title}"\`${screenshotGate}

Only output \`<ready-for-review/>\` AFTER committing AND all local checks pass.
Do NOT output this signal until both conditions are true. You cannot lie to exit.`);

  return parts.join("\n\n---\n\n");
}
