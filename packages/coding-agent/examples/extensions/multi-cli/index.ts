/**
 * Multi-CLI Provider Extension
 *
 * Registers gemini-cli and claude-cli as selectable providers in pi.
 * Each model tier maps to a specific CLI command and model name.
 *
 * Usage: select a model in pi with /model or ctrl+l
 *   gemini-cli/flash   → gemini -m gemini-2.5-flash
 *   gemini-cli/pro     → gemini -m gemini-2.5-pro
 *   claude-cli/haiku   → claude --print -m claude-haiku-4-5-20251001
 *   claude-cli/sonnet  → claude --print -m claude-sonnet-4-6
 *   claude-cli/opus    → claude --print -m claude-opus-4-6
 */

import { spawn, spawnSync } from "node:child_process";
import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Debug logging ───────────────────────────────────────────────────────────

const DEBUG_LOG = "/tmp/pi-multi-cli-debug.log";

function debugLog(entry: Record<string, unknown>) {
	try {
		const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
		spawnSync("tee", ["-a", DEBUG_LOG], {
			input: `${line}\n`,
			encoding: "utf8",
			stdio: ["pipe", "ignore", "ignore"],
		});
	} catch (err) {
		process.stderr.write(`[multi-cli debug error] ${err}\n`);
	}
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CliModelDef {
	id: string;
	name: string;
	command: string;
	args: (model: string, prompt: string) => string[];
	cliModel: string;
	timeoutMs: number;
}

// ─── Prompt serialization ─────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 60_000;

function serializeContent(content: Message["content"]): string {
	if (typeof content === "string") return content.trim();
	return (content as Array<{ type: string; text?: string; mimeType?: string }>)
		.map((item) => (item.type === "text" ? (item.text?.trim() ?? "") : `[image: ${item.mimeType}]`))
		.filter(Boolean)
		.join("\n");
}

function buildPrompt(context: Context): string {
	const lines: string[] = [];

	for (const msg of context.messages) {
		if (msg.role === "user") {
			lines.push(`USER:\n${serializeContent(msg.content)}`);
		} else if (msg.role === "assistant") {
			const parts = (msg.content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text" && c.text?.trim())
				.map((c) => c.text!.trim());
			if (parts.length) lines.push(`ASSISTANT:\n${parts.join("\n")}`);
		}
	}

	lines.push("ASSISTANT:");
	const full = lines.join("\n\n");
	// Guard against oversized prompts
	return full.length > MAX_PROMPT_CHARS ? full.slice(full.length - MAX_PROMPT_CHARS) : full;
}

function _getLastUserPrompt(context: Context): string {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg.role === "user") return serializeContent(msg.content);
	}
	return "";
}

// ─── CLI bridge ───────────────────────────────────────────────────────────────

function createOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function streamCli(model: Model<Api>, context: Context, def: CliModelDef, _options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createOutput(model);
		const prompt = buildPrompt(context);
		const args = def.args(def.cliModel, prompt);

		// Log the call
		debugLog({
			event: "call_start",
			provider: model.provider,
			model: model.id,
			cli_model: def.cliModel,
			command: def.command,
			args: args.map((a, i) => (i === args.length - 1 ? a.slice(0, 200) + (a.length > 200 ? "…" : "") : a)),
		});

		stream.push({ type: "start", partial: output });

		let textStarted = false;
		let timedOut = false;
		let aborted = false;
		const stderrChunks: string[] = [];

		const proc = spawn(def.command, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
		}, def.timeoutMs);

		const abortHandler = () => {
			aborted = true;
			proc.kill("SIGTERM");
		};
		_options?.signal?.addEventListener("abort", abortHandler, { once: true });

		const finishWithError = (reason: "aborted" | "error", message: string) => {
			debugLog({ event: "call_error", provider: model.provider, model: model.id, reason, message });
			output.stopReason = reason;
			output.errorMessage = message;
			stream.push({ type: "error", reason, error: output });
			stream.end();
		};

		proc.stdout.on("data", (chunk: Buffer) => {
			const delta = chunk.toString();
			if (!textStarted) {
				output.content.push({ type: "text", text: "" });
				textStarted = true;
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
			}
			const block = output.content[0] as { type: string; text: string } | undefined;
			if (block?.type === "text") {
				block.text += delta;
				stream.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString()));

		proc.on("error", (err: Error) => {
			clearTimeout(timeoutId);
			_options?.signal?.removeEventListener("abort", abortHandler);
			finishWithError("error", err.message);
		});

		proc.on("close", (code: number | null) => {
			clearTimeout(timeoutId);
			_options?.signal?.removeEventListener("abort", abortHandler);

			if (aborted) {
				finishWithError("aborted", "Aborted");
				return;
			}
			if (timedOut) {
				finishWithError("error", `Timeout after ${def.timeoutMs}ms`);
				return;
			}
			if (code !== 0) {
				finishWithError("error", stderrChunks.join("").trim() || `Exit code ${code}`);
				return;
			}

			const block = output.content[0] as { type: string; text: string } | undefined;
			const text = block?.type === "text" ? block.text.trim() : "";
			if (!text) {
				finishWithError("error", stderrChunks.join("").trim() || "No output from CLI");
				return;
			}
			if (block?.type === "text") {
				block.text = text;
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
			}
			output.stopReason = "stop";
			debugLog({
				event: "call_done",
				provider: model.provider,
				model: model.id,
				response_preview: text.slice(0, 200),
			});
			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		});
	})();

	return stream;
}

// ─── Model definitions ────────────────────────────────────────────────────────

const GEMINI_CLI_API = "gemini-cli-text" as Api;
const CLAUDE_CLI_API = "claude-cli-text" as Api;

const GEMINI_MODELS: CliModelDef[] = [
	{
		id: "flash",
		name: "Gemini CLI Flash",
		command: "gemini",
		cliModel: "gemini-2.5-flash",
		timeoutMs: 30_000,
		args: (model, prompt) => ["-m", model, "--output-format", "text", prompt],
	},
	{
		id: "pro",
		name: "Gemini CLI Pro",
		command: "gemini",
		cliModel: "gemini-2.5-pro",
		timeoutMs: 90_000,
		args: (model, prompt) => ["-m", model, "--output-format", "text", prompt],
	},
];

const CLAUDE_MODELS: CliModelDef[] = [
	{
		id: "haiku",
		name: "Claude CLI Haiku",
		command: "claude",
		cliModel: "claude-haiku-4-5-20251001",
		timeoutMs: 30_000,
		args: (model, prompt) => [
			"--print",
			"--model",
			model,
			"--output-format",
			"text",
			"--tools",
			"",
			"--setting-sources",
			"",
			prompt,
		],
	},
	{
		id: "sonnet",
		name: "Claude CLI Sonnet",
		command: "claude",
		cliModel: "claude-sonnet-4-6",
		timeoutMs: 60_000,
		args: (model, prompt) => [
			"--print",
			"--model",
			model,
			"--output-format",
			"text",
			"--tools",
			"",
			"--setting-sources",
			"",
			prompt,
		],
	},
	{
		id: "opus",
		name: "Claude CLI Opus",
		command: "claude",
		cliModel: "claude-opus-4-6",
		timeoutMs: 120_000,
		args: (model, prompt) => [
			"--print",
			"--model",
			model,
			"--output-format",
			"text",
			"--tools",
			"",
			"--setting-sources",
			"",
			prompt,
		],
	},
];

// ─── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Register gemini-cli provider
	pi.registerProvider("gemini-cli", {
		baseUrl: "local://gemini-cli",
		apiKey: "!printf gemini-cli",
		api: GEMINI_CLI_API,
		streamSimple: (model, context, options) => {
			const def = GEMINI_MODELS.find((m) => m.id === model.id)!;
			return streamCli(model, context, def, options);
		},
		models: GEMINI_MODELS.map((m) => ({
			id: m.id,
			name: m.name,
			reasoning: false,
			input: ["text"] as ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 8_192,
		})),
	});

	// Register claude-cli provider
	pi.registerProvider("claude-cli", {
		baseUrl: "local://claude-cli",
		apiKey: "!printf claude-cli",
		api: CLAUDE_CLI_API,
		streamSimple: (model, context, options) => {
			const def = CLAUDE_MODELS.find((m) => m.id === model.id)!;
			return streamCli(model, context, def, options);
		},
		models: CLAUDE_MODELS.map((m) => ({
			id: m.id,
			name: m.name,
			reasoning: false,
			input: ["text"] as ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 8_192,
		})),
	});
}
