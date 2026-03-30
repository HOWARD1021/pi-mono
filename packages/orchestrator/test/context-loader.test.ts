import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContext } from "../src/context-loader.js";

describe("ContextLoader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `ctx-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads and concatenates context files", () => {
    writeFileSync(join(tempDir, "a.md"), "# File A\nContent A");
    writeFileSync(join(tempDir, "b.md"), "# File B\nContent B");
    const result = loadContext([join(tempDir, "a.md"), join(tempDir, "b.md")]);
    expect(result).toContain("File A");
    expect(result).toContain("File B");
  });

  it("returns empty string for no files", () => {
    expect(loadContext([])).toBe("");
  });

  it("truncates at character limit", () => {
    const big = "x".repeat(20_000);
    writeFileSync(join(tempDir, "big.md"), big);
    const result = loadContext([join(tempDir, "big.md")], 1000);
    expect(result.length).toBeLessThanOrEqual(1100); // some padding for header
  });

  it("labels each file with its path", () => {
    writeFileSync(join(tempDir, "customer.md"), "VIP customer info");
    const result = loadContext([join(tempDir, "customer.md")]);
    expect(result).toContain("customer.md");
    expect(result).toContain("VIP customer info");
  });
});
