import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { FailureContext } from "./types.js";

const MAX_CI_OUTPUT = 3_000;

export class FailureExtractor {
  async extract(ciErrorOutput: string): Promise<FailureContext> {
    const truncated = ciErrorOutput.slice(0, MAX_CI_OUTPUT);

    const client = new RpcClient({});
    await client.start();

    try {
      const models = await (client as any).getAvailableModels?.() ?? [];
      const smallModel =
        models.find((m: any) => m.id.includes("haiku"))?.id ??
        models.find((m: any) => m.id.includes("flash"))?.id ??
        models[0]?.id ??
        "claude-haiku-4-5-20251001";

      await (client as any).setModel?.("anthropic", smallModel);

      await (client as any).promptAndWait?.(
        `Extract the root cause of this CI failure. Be concise. Output ONLY valid JSON matching this schema:
{ "summary": "2-3 sentence root cause", "failedTests": ["test name 1"], "approach": "what the previous implementation tried" }

CI output:
${truncated}`,
        [],
        30_000
      );

      const text = await client.getLastAssistantText();
      if (!text) throw new Error("No response from failure extractor");

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in extractor response");

      return JSON.parse(jsonMatch[0]) as FailureContext;
    } catch {
      return {
        summary: truncated.slice(0, 500),
        failedTests: [],
        approach: "unknown",
      };
    } finally {
      await client.stop();
    }
  }
}
