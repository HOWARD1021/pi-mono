import { execSync, spawn } from "node:child_process";
import type { AgentResult } from "./types.js";

const COMPLETION_SIGNAL = "<ready-for-review/>";

export class AgentRunner {
  constructor(private readonly worktreePath: string) {}

  run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn("claude", ["-p", prompt, "--model", model], {
        cwd: this.worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          proc.kill();
          reject(new Error(`Agent timeout: <ready-for-review/> never appeared after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        if (!completed && chunk.toString().includes(COMPLETION_SIGNAL)) {
          completed = true;
          clearTimeout(timer);
          proc.kill();
          resolve({
            summary: null,
            lastCommitSha: this.getHeadSha(),
          });
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (!completed) {
          reject(new Error(`Agent exited (code ${code}) without outputting <ready-for-review/>`));
        }
      });
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
