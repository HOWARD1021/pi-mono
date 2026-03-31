import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

vi.mock("@mariozechner/pi-coding-agent/modes", () => {
  const mockClient = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockResolvedValue("Task complete"),
    onEvent: vi.fn(),
  };
  return {
    RpcClient: vi.fn(() => mockClient),
    _mockClient: mockClient,
  };
});

import { AgentRunner } from "../src/agent-runner.js";

describe("AgentRunner", () => {
  it("resolves when <ready-for-review/> is detected in event stream", async () => {
    const { RpcClient, _mockClient } = await import("@mariozechner/pi-coding-agent/modes");

    _mockClient.onEvent.mockImplementation((cb: (e: AgentEvent) => void) => {
      setTimeout(() => {
        cb({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Work done. <ready-for-review/>" }],
          },
        } as unknown as AgentEvent);
      }, 10);
      return () => {};
    });

    const runner = new AgentRunner("/path/to/worktree");
    const result = await runner.run("Do some work", "claude-opus-4-6", 5000);
    expect(result.summary).toBe("Task complete");
  });

  it("rejects on timeout without completion signal", async () => {
    const { RpcClient, _mockClient } = await import("@mariozechner/pi-coding-agent/modes");

    _mockClient.onEvent.mockImplementation(() => () => {});  // never emits

    const runner = new AgentRunner("/path/to/worktree");
    await expect(runner.run("Do some work", "claude-opus-4-6", 100)).rejects.toThrow(/timed out/i);
  });
});
