import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { ReviewOrchestrator } from "../src/review-orchestrator.js";

describe("ReviewOrchestrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes when reviewer returns no CRITICAL issues", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from("diff --git a/foo.ts b/foo.ts\n+new line")) // gh pr diff
      .mockReturnValueOnce(Buffer.from("LGTM — no issues found."));               // claude -p

    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(true);
    expect(result.criticalIssues).toHaveLength(0);
  });

  it("fails and surfaces CRITICAL issues from reviewer", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from("diff --git a/foo.ts b/foo.ts\n+new line")) // gh pr diff
      .mockReturnValueOnce(Buffer.from("CRITICAL: SQL injection in line 12"));     // claude -p

    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(false);
    expect(result.criticalIssues.some((i) => i.includes("SQL injection"))).toBe(true);
  });
});
