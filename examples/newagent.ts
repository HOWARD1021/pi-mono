/**
 * Simple, app-facing example using the high-level Agent API.
 *
 * This is the "easy to modify" version of `run-agent-loop.ts`.
 * You usually only need to change:
 *   - system prompt
 *   - tools
 *   - user prompt
 *
 * Run with:
 *   bun run examples/newagent.ts
 *
 * Optional env overrides:
 *   LOCAL_LLM_API_BASE=http://localhost:8317/v1
 *   LOCAL_LLM_API_KEY=quotio-local-716AEC5B
 *   LOCAL_LLM_MODEL=gpt-5
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const LOCAL_API_BASE = process.env.LOCAL_LLM_API_BASE ?? "http://localhost:8317/v1";
const LOCAL_API_KEY = process.env.LOCAL_LLM_API_KEY ?? "quotio-local-716AEC5B";
const LOCAL_MODEL_ID = process.env.LOCAL_LLM_MODEL ?? "gpt-5";

function createLocalProxyModel(modelId: string) {
	const baseRef = getModel("openrouter", "openai/gpt-4o");
	return {
		...baseRef,
		provider: "openrouter" as const,
		id: modelId,
		baseUrl: LOCAL_API_BASE,
		compat: {
			...baseRef.compat,
			supportsStore: false,
			supportsUsageInStreaming: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsStrictMode: false,
		},
	};
}

const getCurrentTimeTool: AgentTool = {
	name: "get_current_time",
	label: "Get Current Time",
	description: "Returns the current date and time as an ISO 8601 timestamp.",
	parameters: Type.Object({}),
	execute: async () => {
		const now = new Date().toISOString();
		return {
			content: [{ type: "text", text: now }],
			details: {},
		};
	},
};

function getLastAssistantText(agent: Agent): string {
	for (let i = agent.state.messages.length - 1; i >= 0; i--) {
		const message = agent.state.messages[i];
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			continue;
		}

		const text = message.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("")
			.trim();

		if (text) {
			return text;
		}
	}

	return "(no assistant text found)";
}

const agent = new Agent({
	initialState: {
		systemPrompt: "You are a helpful assistant. Use the available tools when needed.",
		model: createLocalProxyModel(LOCAL_MODEL_ID),
		thinkingLevel: "off",
		tools: [getCurrentTimeTool],
		messages: [],
	},
	getApiKey: async () => LOCAL_API_KEY,
});

let streamBuffer = "";

agent.subscribe((event) => {
	switch (event.type) {
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") {
				if (!streamBuffer) {
					process.stdout.write("[STREAMING] ");
				}
				process.stdout.write(event.assistantMessageEvent.delta);
				streamBuffer += event.assistantMessageEvent.delta;
			}
			break;

		case "message_end":
			if (streamBuffer) {
				console.log();
				streamBuffer = "";
			}
			break;

		case "tool_execution_start":
			console.log(`[TOOL CALL] ${event.toolName}`);
			break;

		case "tool_execution_end": {
			const resultText = event.result.content
				.filter((content: { type: string; text?: string }) => content.type === "text")
				.map((content: { text?: string }) => content.text ?? "")
				.join("");
			const label = event.isError ? "[TOOL ERROR]" : "[TOOL RESULT]";
			console.log(`${label} ${resultText}`);
			break;
		}
	}
});

const prompt = "What time is it right now? Use the get_current_time tool to find out.";

console.log("[NEW AGENT] ─────────────────────────");
await agent.prompt(prompt);

if (streamBuffer) {
	console.log();
}

console.log("[FINAL ANSWER]");
console.log(getLastAssistantText(agent));
console.log(`Messages in state: ${agent.state.messages.length}`);
