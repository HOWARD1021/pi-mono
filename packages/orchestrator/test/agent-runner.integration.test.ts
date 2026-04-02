import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process before importing module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("abc1234\n")),
}));

import { spawn } from "node:child_process";
import { AgentRunner } from "../src/agent-runner.js";

function makeProc(stdoutLines: string[], exitCode = 0) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = vi.fn();

  // Emit stdout lines async, then close
  setTimeout(() => {
    for (const line of stdoutLines) {
      stdout.emit("data", Buffer.from(line));
    }
    proc.emit("close", exitCode);
  }, 10);

  return proc;
}

describe("AgentRunner", () => {
  it("resolves when <ready-for-review/> appears in stdout", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProc(["Working on it...\n", "All done. <ready-for-review/>\n"]) as any
    );

    const runner = new AgentRunner("/wt/task-1");
    const result = await runner.run("Do the work", "claude-opus-4-6", 5000);

    expect(result.lastCommitSha).toBe("abc1234");
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "Do the work"]),
      expect.objectContaining({ cwd: "/wt/task-1" })
    );
  });

  it("rejects on timeout when signal never appears", async () => {
    vi.mocked(spawn).mockReturnValue(makeProc([]) as any); // exits with no signal

    const runner = new AgentRunner("/wt/task-1");
    await expect(
      runner.run("Do the work", "claude-opus-4-6", 50)
    ).rejects.toThrow(/timeout|ready-for-review/i);
  });
});
