import { execSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult } from "./types.js";

const COMPLETION_SIGNAL = "<ready-for-review/>";

export class AgentRunner {
	constructor(
		private readonly worktreePath: string,
		private readonly backend: "claude" | "copilot" = "claude",
	) {}

	private buildSpawnArgs(prompt: string, model: string, logDir?: string): [string, string[]] {
		if (this.backend === "copilot") {
			const args = ["-p", prompt, "--model", model, "--yolo", "--autopilot", "--no-ask-user", "-s"];
			if (logDir) args.push("--log-level", "debug", "--log-dir", logDir);
			return ["copilot", args];
		}
		return ["claude", ["-p", prompt, "--model", model, "--dangerously-skip-permissions", "--verbose"]];
	}

	run(prompt: string, model: string, timeoutMs = 30 * 60 * 1000, baseSha?: string): Promise<AgentResult> {
		// Context file pattern (borrowed from codex-delegate):
		// Write full prompt to disk so it survives crashes and leaves an audit trail.
		// Pass a short reference prompt to the CLI instead of the full inline string.
		const contextDir = join(this.worktreePath, ".agent-context");
		mkdirSync(contextDir, { recursive: true });
		const contextFile = join(contextDir, "task.md");
		writeFileSync(contextFile, prompt, "utf8");
		const refPrompt = "Read .agent-context/task.md and execute all instructions inside.";

		// Clean up stale sentinel files from previous runs
		for (const f of [".agent-done", ".agent-error", ".agent-fallback"]) {
			try {
				require("node:fs").rmSync(join(this.worktreePath, f));
			} catch {
				/* not present */
			}
		}

		// For copilot, capture debug logs so we can show tool calls after the run
		const logDir = this.backend === "copilot" ? `/tmp/copilot-logs/${Date.now()}` : undefined;
		if (logDir) mkdirSync(logDir, { recursive: true });

		return new Promise((resolve, reject) => {
			const [cmd, args] = this.buildSpawnArgs(refPrompt, model, logDir);
			const proc = spawn(cmd, args, {
				cwd: this.worktreePath,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let completed = false;
			let pendingResult: AgentResult | null = null;
			let pendingError: Error | null = null;

			const timer = setTimeout(() => {
				if (!completed) {
					proc.kill();
					const msg = `TIMEOUT|${timeoutMs}ms|${new Date().toISOString()}`;
					writeFileSync(join(this.worktreePath, ".agent-error"), msg, "utf8");
					pendingError = new Error(`Agent timeout: <ready-for-review/> never appeared after ${timeoutMs}ms`);
				}
			}, timeoutMs);

			let fullOutput = "";
			let lineBuffer = "";

			proc.stdout.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				fullOutput += text;
				lineBuffer += text;
				const lines = lineBuffer.split("\n");
				lineBuffer = lines.pop() ?? "";
				for (const line of lines) {
					process.stdout.write(`[agent] ${line}\n`);
				}
				if (!completed && fullOutput.includes(COMPLETION_SIGNAL)) {
					completed = true;
					clearTimeout(timer);
					const newSha = this.getHeadSha();
					if (baseSha !== undefined && newSha === baseSha) {
						writeFileSync(
							join(this.worktreePath, ".agent-error"),
							`HARD_FAIL|no-commit|${new Date().toISOString()}`,
							"utf8",
						);
						pendingError = new Error("Agent output <ready-for-review/> but made no commit");
					} else {
						writeFileSync(
							join(this.worktreePath, ".agent-done"),
							`DONE|${model}|${newSha}|${new Date().toISOString()}`,
							"utf8",
						);
						pendingResult = { summary: null, lastCommitSha: newSha };
					}
					proc.kill();
				}
			});

			proc.stderr.on("data", (chunk: Buffer) => {
				process.stderr.write(`[agent-err] ${chunk.toString()}`);
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				if (lineBuffer) {
					process.stdout.write(`[agent] ${lineBuffer}\n`);
					lineBuffer = "";
				}
				// Print tool call summary from debug logs — happens before resolve so
				// it appears between "Agent done" and "Running evaluator" in eval-loop output
				if (logDir) printCopilotToolSummary(logDir);

				if (pendingResult) {
					resolve(pendingResult);
				} else if (pendingError) {
					reject(pendingError);
				} else {
					writeFileSync(
						join(this.worktreePath, ".agent-error"),
						`HARD_FAIL|exit ${code}|${new Date().toISOString()}`,
						"utf8",
					);
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

/**
 * Parse copilot debug logs and print a clean tool call trace.
 * The debug log contains raw OpenAI-format API responses; each LLM turn that
 * called tools has a "tool_calls" array with function.name + function.arguments.
 */
function printCopilotToolSummary(logDir: string): void {
	try {
		const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));
		if (files.length === 0) return;

		const logContent = readFileSync(join(logDir, files[0]), "utf8");

		// Match actual tool_call objects: "function": { "name": "...", "arguments": "..." }
		// Tool definitions don't have "arguments" at this level, so this is safe.
		const toolCallRegex = /"function":\s*\{\s*"name":\s*"([^"]+)",\s*"arguments":\s*"((?:[^"\\]|\\.)*)"/g;
		const toolCalls: Array<{ name: string; summary: string }> = [];

		for (const match of logContent.matchAll(toolCallRegex)) {
			const name = match[1];
			if (name === "report_intent") continue; // UI hint only, not real work

			const rawArgs = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
			let summary: string;
			try {
				const args = JSON.parse(rawArgs) as Record<string, unknown>;
				summary = formatToolArgs(args);
			} catch {
				summary = rawArgs.slice(0, 100);
			}
			toolCalls.push({ name, summary });
		}

		if (toolCalls.length === 0) return;

		console.log(`[agent:trace] ${toolCalls.length} tool calls:`);
		for (const tc of toolCalls) {
			console.log(`[agent:tool]  ${tc.name.padEnd(10)} → ${tc.summary}`);
		}
	} catch {
		/* ignore — log parsing is best-effort */
	}
}

function formatToolArgs(args: Record<string, unknown>): string {
	if (args.command) return String(args.command).slice(0, 120);
	if (args.path) return String(args.path).slice(0, 120);
	if (args.file_path) return String(args.file_path).slice(0, 120);
	if (args.content && args.file_path) return `${args.file_path}`;
	// Generic: show first non-description key
	const key = Object.keys(args).find((k) => k !== "description");
	if (key) return `${key}=${JSON.stringify(args[key]).slice(0, 80)}`;
	return JSON.stringify(args).slice(0, 100);
}
