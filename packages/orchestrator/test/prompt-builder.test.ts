import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/prompt-builder.js";
import type { ParsedTask } from "../src/types.js";

const task: ParsedTask = {
  id: "task-1",
  title: "Build API",
  model: "claude-opus-4-6",
  maxRetries: 3,
  requiresScreenshots: false,
  dependsOn: [],
  description: "Build a REST API endpoint for user profiles.",
};

describe("PromptBuilder", () => {
  it("includes task description", () => {
    const p = buildPrompt(task, "", [], "");
    expect(p).toContain("Build a REST API endpoint");
  });

  it("includes context when provided", () => {
    const p = buildPrompt(task, "## Context: vault.md\n\nVIP data", [], "");
    expect(p).toContain("VIP data");
  });

  it("includes completion gate instructions", () => {
    const p = buildPrompt(task, "", [], "");
    expect(p).toContain("<ready-for-review/>");
    expect(p).toContain("bun test");
    expect(p).toContain("git commit");
  });

  it("includes attempt history on retry", () => {
    const history = ["Attempt 1 failed: TypeError in src/api.ts at line 42"];
    const p = buildPrompt(task, "", history, "");
    expect(p).toContain("Previous Attempts");
    expect(p).toContain("TypeError");
    expect(p).toContain("different approach");
  });

  it("includes git log when provided", () => {
    const p = buildPrompt(task, "", [], "abc1234 feat: initial");
    expect(p).toContain("abc1234");
  });

  it("requires screenshots in gate when task demands it", () => {
    const screenshotTask = { ...task, requiresScreenshots: true };
    const p = buildPrompt(screenshotTask, "", [], "");
    expect(p).toContain("screenshot");
  });
});
