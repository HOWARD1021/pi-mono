import { execSync } from "node:child_process";
import type { FailureContext } from "./types.js";

const MAX_CI_OUTPUT = 3_000;

export class FailureExtractor {
  async extract(ciErrorOutput: string): Promise<FailureContext> {
    const truncated = ciErrorOutput.slice(0, MAX_CI_OUTPUT);

    try {
      const prompt = `Extract the root cause of this CI failure. Be concise. Output ONLY valid JSON matching this schema:
{ "summary": "2-3 sentence root cause", "failedTests": ["test name 1"], "approach": "what the previous implementation tried" }

CI output:
${truncated}`;

      const out = execSync(
        `claude -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model claude-haiku-4-5-20251001`,
        { stdio: "pipe", timeout: 30_000 }
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
