import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Pi Orchestrator E2E smoke test", () => {
  it(
    "orchestrates a single minimal task end-to-end",
    async () => {
      const { orchestrate } = await import("../src/index.js");

      let tempDir = "";
      try {
        tempDir = join(tmpdir(), `smoke-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });

        const specPath = join(tempDir, "smoke-spec.md");
        writeFileSync(
          specPath,
          `---
feature: Smoke Test
context: []
tasks:
  - id: smoke-task-1
    title: Add test comment
    max-retries: 1
---

## smoke-task-1

Add the comment \`// SMOKE_TEST_${Date.now()}\` to any file in the project as a new line.
Commit this single change and output <ready-for-review/>.
`
        );

        await expect(orchestrate(specPath)).resolves.toBeUndefined();
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    },
    { timeout: 10 * 60 * 1000 }
  );
});
