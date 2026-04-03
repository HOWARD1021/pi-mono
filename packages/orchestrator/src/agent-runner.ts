import { execSync, spawn } from "node:child_process";
import type { AgentResult } from "./types.js";

const COMPLETION_SIGNAL = "<ready-for-review/>";

export class AgentRunner {
	constructor(private readonly worktreePath: string) {}

	run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000, baseSha?: string): Promise<AgentResult> {
		return new Promise((resolve, reject) => {
			const proc = spawn("claude", ["-p", prompt, "--model", model, "--dangerously-skip-permissions"], {
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

			let fullOutput = "";

			proc.stdout.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				fullOutput += text;
				process.stdout.write(`[agent] ${text}`);
				if (!completed && text.includes(COMPLETION_SIGNAL)) {
					completed = true;
					clearTimeout(timer);
					proc.kill();
					const newSha = this.getHeadSha();
					if (baseSha !== undefined && newSha === baseSha) {
						reject(new Error("Agent output <ready-for-review/> but made no commit"));
						return;
					}
					resolve({
						summary: null,
						lastCommitSha: newSha,
					});
				}
			});

			proc.stderr.on("data", (chunk: Buffer) => {
				process.stderr.write(`[agent-err] ${chunk.toString()}`);
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				if (!completed) {
					reject(
						new Error(
							`Agent exited (code ${code}) without outputting <ready-for-review/>. Last output:\n${fullOutput.slice(-500)}`,
						),
					);
				}
			});
		});
	}

	private getHeadSha(): string {
		try {
			return execSync("git rev-parse HEAD", {
				cwd: this.worktreePath,
				stdio: "pipe",
			})
				.toString()
				.trim();
		} catch {
			return "unknown";
		}
	}
}
