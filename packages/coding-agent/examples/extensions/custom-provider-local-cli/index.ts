/**
 * Local CLI Provider Extension
 *
 * Bridges pi-coding-agent to a local CLI by spawning a subprocess.
 *
 * Default behavior mirrors `Tools/Inference.ts`:
 * - command: `claude`
 * - models: fast / standard / smart
 * - args: `--print --model ... --tools '' --output-format text --setting-sources ''`
 *
 * Usage:
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-local-cli
 *   # Then /model local-cli/standard
 *
 * Optional env overrides:
 *   LOCAL_CLI_COMMAND=claude
 *   LOCAL_CLI_ARGS_JSON='["--print","--model","{{model}}","--tools","","--output-format","text","--setting-sources","","--system-prompt","{{systemPrompt}}","{{conversation}}"]'
 *   LOCAL_CLI_FAST_MODEL=haiku
 *   LOCAL_CLI_STANDARD_MODEL=sonnet
 *   LOCAL_CLI_SMART_MODEL=opus
 *   LOCAL_CLI_FAST_TIMEOUT_MS=15000
 *   LOCAL_CLI_STANDARD_TIMEOUT_MS=30000
 *   LOCAL_CLI_SMART_TIMEOUT_MS=90000
 *   LOCAL_CLI_STRIP_ENV_VARS=ANTHROPIC_API_KEY
 *
 * Notes:
 * - This example is text-only. It does not translate pi tool calls into CLI tool calls.
 * - The spawned CLI runs in the current working directory, so adapt with care.
 */

import { spawn } from "node:child_process";
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

type Level = "fast" | "standard" | "smart";

interface LevelConfig {
	id: Level;
	name: string;
	cliModel: string;
	timeoutMs: number;
}

const LOCAL_CLI_API = "local-cli-text" as Api;
const DEFAULT_COMMAND = "claude";
const DEFAULT_ARGS_TEMPLATE = [
	"--print",
	"--model",
	"{{model}}",
	"--tools",
	"",
	"--output-format",
	"text",
	"--setting-sources",
	"",
	"--system-prompt",
	"{{systemPrompt}}",
	"{{conversation}}",
];

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLevelConfigs(): LevelConfig[] {
	return [
		{
			id: "fast",
			name: "Local CLI Fast",
			cliModel: process.env.LOCAL_CLI_FAST_MODEL ?? "haiku",
			timeoutMs: parsePositiveInt(process.env.LOCAL_CLI_FAST_TIMEOUT_MS, 15_000),
		},
		{
			id: "standard",
			name: "Local CLI Standard",
			cliModel: process.env.LOCAL_CLI_STANDARD_MODEL ?? "sonnet",
			timeoutMs: parsePositiveInt(process.env.LOCAL_CLI_STANDARD_TIMEOUT_MS, 30_000),
		},
		{
			id: "smart",
			name: "Local CLI Smart",
			cliModel: process.env.LOCAL_CLI_SMART_MODEL ?? "opus",
			timeoutMs: parsePositiveInt(process.env.LOCAL_CLI_SMART_TIMEOUT_MS, 90_000),
		},
	];
}

function getCommand(): string {
	return process.env.LOCAL_CLI_COMMAND?.trim() || DEFAULT_COMMAND;
}

function getArgsTemplate(): string[] {
	const raw = process.env.LOCAL_CLI_ARGS_JSON;
	if (!raw) return DEFAULT_ARGS_TEMPLATE;

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
			return parsed;
		}
	} catch {
		// Fall back to defaults when the env value is malformed.
	}

	return DEFAULT_ARGS_TEMPLATE;
}

function buildCliEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const strip = process.env.LOCAL_CLI_STRIP_ENV_VARS ?? "ANTHROPIC_API_KEY";

	for (const key of strip.split(",")) {
		const trimmed = key.trim();
		if (trimmed) {
			delete env[trimmed];
		}
	}

	return env;
}

function serializeContent(content: Message["content"]): string {
	if (typeof content === "string") {
		return content.trim();
	}

	const parts: string[] = [];
	for (const item of content) {
		if (item.type === "text") {
			parts.push(item.text.trim());
		} else if (item.type === "image") {
			parts.push(`[image omitted: ${item.mimeType}]`);
		}
	}

	return parts.filter(Boolean).join("\n");
}

function serializeAssistantContent(message: Extract<Message, { role: "assistant" }>): string {
	const parts: string[] = [];

	for (const item of message.content) {
		if (item.type === "text" && item.text.trim()) {
			parts.push(item.text.trim());
		} else if (item.type === "thinking" && item.thinking.trim()) {
			parts.push(`[thinking omitted]\n${item.thinking.trim()}`);
		} else if (item.type === "toolCall") {
			parts.push(`[tool call omitted: ${item.name} ${JSON.stringify(item.arguments)}]`);
		}
	}

	return parts.join("\n");
}

function serializeConversation(context: Context): string {
	const sections: string[] = [
		"You are continuing an existing conversation.",
		"Reply as the assistant to the latest user intent.",
		"If the surrounding app mentions tools, explain limitations instead of emitting tool calls.",
	];

	if (context.tools?.length) {
		sections.push(
			`Available app tools (not callable through this bridge): ${context.tools.map((tool) => tool.name).join(", ")}`,
		);
	}

	for (const message of context.messages) {
		if (message.role === "user") {
			sections.push(`USER:\n${serializeContent(message.content)}`);
		} else if (message.role === "assistant") {
			sections.push(`ASSISTANT:\n${serializeAssistantContent(message)}`);
		} else if (message.role === "toolResult") {
			sections.push(`TOOL RESULT (${message.toolName}):\n${serializeContent(message.content)}`);
		}
	}

	sections.push("ASSISTANT:");
	return sections.join("\n\n");
}

function getLastUserPrompt(messages: Context["messages"]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === "user") {
			return serializeContent(message.content);
		}
	}

	return "";
}

function interpolate(template: string, values: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

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

function streamLocalCli(model: Model<Api>, context: Context, _options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createOutput(model);
		const config = getLevelConfigs().find((entry) => entry.id === model.id);
		const command = getCommand();
		const argsTemplate = getArgsTemplate();
		const timeoutMs = config?.timeoutMs ?? 30_000;

		const values = {
			model: config?.cliModel ?? model.id,
			systemPrompt: [
				context.systemPrompt?.trim(),
				"You are running through a local CLI bridge. Return plain assistant text only.",
			]
				.filter(Boolean)
				.join("\n\n"),
			conversation: serializeConversation(context),
			userPrompt: getLastUserPrompt(context.messages),
			cwd: process.cwd(),
		};

		const args = argsTemplate.map((arg) => interpolate(arg, values));
		const stderrChunks: string[] = [];
		let textStarted = false;
		let timedOut = false;
		let aborted = false;

		stream.push({ type: "start", partial: output });

		const proc = spawn(command, args, {
			env: buildCliEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		const finishWithError = (reason: "aborted" | "error", message: string) => {
			output.stopReason = reason;
			output.errorMessage = message;
			stream.push({ type: "error", reason, error: output });
			stream.end();
		};

		const timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
		}, timeoutMs);

		const abortHandler = () => {
			aborted = true;
			proc.kill("SIGTERM");
		};

		_options?.signal?.addEventListener("abort", abortHandler, { once: true });

		proc.stdout.on("data", (chunk) => {
			const delta = chunk.toString();
			if (!textStarted) {
				output.content.push({ type: "text", text: "" });
				textStarted = true;
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
			}

			const textBlock = output.content[0];
			if (textBlock?.type === "text") {
				textBlock.text += delta;
				stream.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
			}
		});

		proc.stderr.on("data", (chunk) => {
			stderrChunks.push(chunk.toString());
		});

		proc.on("error", (error) => {
			clearTimeout(timeoutId);
			_options?.signal?.removeEventListener("abort", abortHandler);
			finishWithError("error", error.message);
		});

		proc.on("close", (code) => {
			clearTimeout(timeoutId);
			_options?.signal?.removeEventListener("abort", abortHandler);

			if (aborted) {
				finishWithError("aborted", "Request was aborted");
				return;
			}

			if (timedOut) {
				finishWithError("error", `Timeout after ${timeoutMs}ms`);
				return;
			}

			if (code !== 0) {
				finishWithError("error", stderrChunks.join("").trim() || `Process exited with code ${code}`);
				return;
			}

			const textBlock = output.content[0];
			const finalText = textBlock?.type === "text" ? textBlock.text.trim() : "";
			if (!finalText) {
				finishWithError("error", stderrChunks.join("").trim() || "CLI returned no text output");
				return;
			}

			if (textBlock?.type === "text") {
				textBlock.text = finalText;
				stream.push({ type: "text_end", contentIndex: 0, content: finalText, partial: output });
			}

			output.stopReason = "stop";
			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		});
	})();

	return stream;
}

export default function (pi: ExtensionAPI) {
	const models = getLevelConfigs();

	pi.registerProvider("local-cli", {
		baseUrl: "local://cli",
		apiKey: "!printf local-cli",
		api: LOCAL_CLI_API,
		streamSimple: streamLocalCli,
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 8_192,
		})),
	});
}
