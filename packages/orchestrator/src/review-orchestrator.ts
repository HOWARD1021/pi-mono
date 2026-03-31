import { execSync } from "node:child_process";
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { ReviewResult } from "./types.js";

interface ReviewerConfig {
  name: string;
  provider: string;
  model: string;
  focus: string;
  apiKeyEnv: string;
}

const REVIEWERS: ReviewerConfig[] = [
  {
    name: "Codex",
    provider: "openai",
    model: "gpt-5.3-codex",
    focus: "Edge cases, logic errors, race conditions, missing error handling",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "Gemini",
    provider: "google",
    model: "gemini-2.0-flash",
    focus: "Security vulnerabilities, accessibility, scalability issues",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    name: "Claude",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    focus: "Correctness validation. Flag CRITICAL issues only — ignore style.",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
];

export class ReviewOrchestrator {
  async review(prNumber: number): Promise<ReviewResult> {
    let diff = "";
    try {
      diff = execSync(`gh pr diff ${prNumber}`, { stdio: "pipe" }).toString().slice(0, 8_000);
    } catch (e) {
      return { passed: false, criticalIssues: [`Failed to fetch PR diff: ${(e as Error).message}`] };
    }

    const results = await Promise.allSettled(
      REVIEWERS.map((r) => this.runReviewer(r, prNumber, diff))
    );

    const criticalIssues: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        criticalIssues.push(...result.value);
      }
    }

    return { passed: criticalIssues.length === 0, criticalIssues };
  }

  private async runReviewer(
    reviewer: ReviewerConfig,
    prNumber: number,
    diff: string
  ): Promise<string[]> {
    const client = new RpcClient({
      provider: reviewer.provider,
      model: reviewer.model,
      env: { [reviewer.apiKeyEnv]: process.env[reviewer.apiKeyEnv] ?? "" },
    } as any);

    await client.start();

    try {
      await (client as any).promptAndWait(
        `You are a ${reviewer.name} code reviewer. Focus: ${reviewer.focus}

Review this PR diff and use the \`gh\` bash tool to post your review comments directly on PR #${prNumber}.

For CRITICAL issues: prefix with "CRITICAL: "
For minor issues: skip them.
If no critical issues: post a short approval comment.

PR Diff:
${diff}`,
        [],
        5 * 60 * 1000
      );

      const text = await client.getLastAssistantText();
      const criticals = (text ?? "")
        .split("\n")
        .filter((l) => l.startsWith("CRITICAL:"))
        .map((l) => `[${reviewer.name}] ${l}`);

      return criticals;
    } finally {
      await client.stop();
    }
  }
}
