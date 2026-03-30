import { describe, expect, it, vi } from "vitest";

// Mock child_process before importing module under test
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { WorktreeManager } from "../src/worktree-manager.js";

describe("WorktreeManager", () => {
  it("create() runs git worktree add and captures base SHA", () => {
    const mockExec = vi.mocked(execSync);
    // First call: git rev-parse → returns SHA
    mockExec.mockReturnValueOnce(Buffer.from("abc1234\n"));
    // Second call: git worktree add
    mockExec.mockReturnValueOnce(Buffer.from(""));
    const manager = new WorktreeManager("/repo");
    const result = manager.create("task-1", "agent/task-1", "main");

    expect(result.path).toContain("task-1");
    expect(result.baseCommitSha).toBe("abc1234");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git rev-parse"),
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object)
    );
  });

  it("reset() runs git reset --hard to stored SHA", () => {
    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue(Buffer.from(""));

    const manager = new WorktreeManager("/repo");
    manager.reset("/tmp/wt/task-1", "abc1234");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git reset --hard abc1234"),
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git push --force-with-lease"),
      expect.any(Object)
    );
  });

  it("remove() runs git worktree remove", () => {
    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue(Buffer.from(""));

    const manager = new WorktreeManager("/repo");
    manager.remove("/tmp/wt/task-1");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("git worktree remove"),
      expect.any(Object)
    );
  });
});
