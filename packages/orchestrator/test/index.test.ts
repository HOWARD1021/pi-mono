import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ summary: "done", lastCommitSha: "abc1234" }),
  })),
}));
vi.mock("../src/ci-runner.js", () => ({
  CIRunner: vi.fn().mockImplementation(() => ({
    runLocal: vi.fn().mockReturnValue({ passed: true, failedChecks: [], errorOutput: "" }),
    runCloud: vi.fn().mockResolvedValue({ passed: true, failedChecks: [], errorOutput: "" }),
  })),
}));
vi.mock("../src/review-orchestrator.js", () => ({
  ReviewOrchestrator: vi.fn().mockImplementation(() => ({
    review: vi.fn().mockResolvedValue({ passed: true, criticalIssues: [] }),
  })),
}));
vi.mock("../src/notifier.js", () => ({
  Notifier: vi.fn().mockImplementation(() => ({
    notifyReady: vi.fn().mockResolvedValue(undefined),
    notifyFailed: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../src/worktree-manager.js", () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockReturnValue({ path: "/wt/task-1", branch: "agent/task-1", baseCommitSha: "base123" }),
    remove: vi.fn(),
    reset: vi.fn(),
  })),
}));
vi.mock("../src/task-registry.js", () => ({
  TaskRegistry: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getRunning: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("../src/failure-extractor.js", () => ({
  FailureExtractor: vi.fn().mockImplementation(() => ({
    extract: vi.fn().mockResolvedValue({ summary: "test failed", failedTests: [], approach: "retry" }),
  })),
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

import { runTaskWithRetry } from "../src/index.js";

const mockTask = {
  id: "task-1", title: "Backend API", description: "Build the API",
  model: "claude-opus-4-6", maxRetries: 3, requiresScreenshots: false, dependsOn: [],
};

describe("runTaskWithRetry", () => {
  it("returns success=true when agent + CI + review all pass on first attempt", async () => {
    const result = await runTaskWithRetry(mockTask, [], "main");
    expect(result.success).toBe(true);
  });
});
