import { execSync } from "node:child_process";
import { RpcClient } from "@mariozechner/pi-coding-agent/modes";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentResult } from "./types.js";

const COMPLETION_SIGNAL = "<ready-for-review/>";

export class AgentRunner {
  constructor(private readonly worktreePath: string) {}

  async run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000): Promise<AgentResult> {
    const client = new RpcClient({
      cwd: this.worktreePath,
      model,
    });

    await client.start();

    try {
      return await this.runWithTimeout(client, prompt, timeoutMs);
    } finally {
      await client.stop();
    }
  }

  private runWithTimeout(client: RpcClient, prompt: string, timeoutMs: number): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          reject(new Error(`Agent timed out after ${timeoutMs}ms without outputting <ready-for-review/>`));
        }
      }, timeoutMs);

      const unsubscribe = client.onEvent((event: AgentEvent) => {
        if (event.type === "message_end") {
          const msg = (event as any).message;
          if (msg?.role === "assistant") {
            const text = (msg.content ?? [])
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text as string)
              .join("");
            if (text.includes(COMPLETION_SIGNAL) && !completed) {
              completed = true;
              clearTimeout(timer);
              unsubscribe?.();
              client.getLastAssistantText().then((summary: string | null) => {
                const sha = this.getHeadSha();
                resolve({ summary, lastCommitSha: sha });
              });
            }
          }
        }
      });

      client.prompt(prompt).catch(reject);
    });
  }

  private getHeadSha(): string {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.worktreePath,
        stdio: "pipe",
      }).toString().trim();
    } catch {
      return "unknown";
    }
  }
}
