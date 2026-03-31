import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("diff --git a/foo.ts b/foo.ts\n+new line")),
}));

const mockGetLastAssistantText = vi.fn();
const mockPromptAndWait = vi.fn().mockResolvedValue(undefined);
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);

vi.mock("@mariozechner/pi-coding-agent/modes", () => ({
  RpcClient: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    promptAndWait: mockPromptAndWait,
    getLastAssistantText: mockGetLastAssistantText,
  })),
}));

import { ReviewOrchestrator } from "../src/review-orchestrator.js";

describe("ReviewOrchestrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes when no reviewer returns CRITICAL issues", async () => {
    mockGetLastAssistantText.mockResolvedValue("LGTM — no issues found.");
    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(true);
    expect(result.criticalIssues).toHaveLength(0);
  });

  it("fails and surfaces CRITICAL issues from reviewers", async () => {
    mockGetLastAssistantText
      .mockResolvedValueOnce("CRITICAL: SQL injection in line 12")
      .mockResolvedValue("LGTM");
    const orchestrator = new ReviewOrchestrator();
    const result = await orchestrator.review(42);
    expect(result.passed).toBe(false);
    expect(result.criticalIssues.some((i) => i.includes("SQL injection"))).toBe(true);
  });
});
