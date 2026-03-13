/**
 * Minimal runnable example of the pi-mono agent loop.
 *
 * Demonstrates:
 *   - The OUTER LOOP: continues when follow-up messages arrive after agent would stop
 *   - The INNER LOOP: processes tool calls + steering messages within a single agent run
 *   - Tool execution: agent calls get_current_time, receives result, responds with natural language
 *   - Event stream: every lifecycle event is printed with labeled output
 *
 * Run with:
 *   bun run examples/run-agent-loop.ts
 *
 * Optional env overrides (defaults shown):
 *   LOCAL_LLM_API_BASE=http://localhost:8317/v1
 *   LOCAL_LLM_API_KEY=quotio-local-716AEC5B
 *   LOCAL_LLM_MODEL=gpt-5
 */

import { Type } from "@sinclair/typebox";
import { getModel } from "@mariozechner/pi-ai";
import { agentLoop } from "@mariozechner/pi-agent-core";
import type { AgentTool, AgentLoopConfig, AgentContext, AgentMessage, AgentEvent } from "@mariozechner/pi-agent-core";
import type { Message, UserMessage } from "@mariozechner/pi-ai";

// ─── 1. Local Proxy Config ───────────────────────────────────────────────────
// Matches the pattern in packages/agent/examples/subagent-perspectives.ts.
// The local proxy speaks the OpenAI-compatible API (openrouter provider shape)
// but routes to your local LLM server at LOCAL_LLM_API_BASE.
const LOCAL_API_BASE = process.env.LOCAL_LLM_API_BASE ?? "http://localhost:8317/v1";
const LOCAL_API_KEY  = process.env.LOCAL_LLM_API_KEY  ?? "quotio-local-716AEC5B";
const LOCAL_MODEL_ID = process.env.LOCAL_LLM_MODEL    ?? "gpt-5";

// ─── 2. Model ────────────────────────────────────────────────────────────────
// We can't call getModel("local", ...) because there's no "local" provider.
// Instead we borrow the openrouter model shape (which uses the OpenAI wire format)
// and override baseUrl + id to point at our local server.
// compat flags disable features the local proxy may not support.
const baseRef = getModel("openrouter", "openai/gpt-4o");
const model = {
	...baseRef,
	provider: "openrouter" as const,
	id: LOCAL_MODEL_ID,
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

// ─── 3. Tool Definition ─────────────────────────────────────────────────────
// AgentTool extends the base Tool (name, description, parameters) with:
//   - label: human-readable label for UI
//   - execute: async function that receives validated args and returns AgentToolResult
const getCurrentTimeTool: AgentTool = {
	name: "get_current_time",
	description: "Returns the current date and time as an ISO 8601 timestamp.",
	label: "Get Current Time",
	// TypeBox schema for the tool parameters (empty object = no params)
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params, _signal, _onUpdate) => {
		const now = new Date().toISOString();
		return {
			content: [{ type: "text", text: now }],
			details: {},
		};
	},
};

// ─── 4. Agent Context ────────────────────────────────────────────────────────
// AgentContext holds the system prompt, message history, and available tools.
// The agent loop mutates context.messages in place as the conversation progresses.
const context: AgentContext = {
	systemPrompt: "You are a helpful assistant. Use the available tools to answer questions.",
	messages: [],
	tools: [getCurrentTimeTool],
};

// ─── 5. User Prompt ──────────────────────────────────────────────────────────
// The prompt is passed as an array of AgentMessage. Here we use a standard UserMessage.
const userPrompt: UserMessage = {
	role: "user",
	content: "What time is it right now? Use the get_current_time tool to find out.",
	timestamp: Date.now(),
};

// ─── 6. Agent Loop Config ────────────────────────────────────────────────────
// AgentLoopConfig extends SimpleStreamOptions and adds:
//   - model: which LLM to use (our local proxy model defined above)
//   - apiKey: the local proxy's API key (not an Anthropic key)
//   - convertToLlm: transforms AgentMessage[] -> Message[] at the LLM call boundary
//   - getSteeringMessages (optional): inject messages mid-run for interruption
//   - getFollowUpMessages (optional): inject messages after agent would stop (outer loop)
//   - transformContext (optional): prune/modify messages before each LLM call
const config: AgentLoopConfig = {
	model,
	apiKey: LOCAL_API_KEY,

	// convertToLlm is called before every LLM request.
	// It maps the internal AgentMessage[] to the LLM-compatible Message[] format.
	// Custom message types would be filtered or converted here.
	// For this simple example, all messages are already standard LLM messages.
	convertToLlm: (messages: AgentMessage[]): Message[] => {
		return messages as Message[];
	},
};

// ─── 7. Run the Agent Loop and Stream Events ────────────────────────────────
// agentLoop() returns an EventStream<AgentEvent, AgentMessage[]>.
// The stream is an async iterable that yields AgentEvent objects.
// The stream also has a .result() promise that resolves to the final AgentMessage[].

let turnCount = 0;
let streamBuffer = "";

console.log("[AGENT START] ─────────────────────────");

const stream = agentLoop([userPrompt], context, config);

// Iterate over every event the agent emits
for await (const event of stream) {
	switch (event.type) {
		// ── Agent lifecycle ──
		case "agent_start":
			// Already printed above before the stream starts
			break;

		case "agent_end":
			// Flush any remaining streamed text
			if (streamBuffer) {
				console.log();
				streamBuffer = "";
			}
			console.log(`[AGENT END] ─────────────────────────`);
			console.log(`Final messages: ${event.messages.length}`);
			break;

		// ── Turn lifecycle ──
		// A "turn" = one assistant response + any tool calls/results it triggers.
		// The INNER LOOP produces multiple turns when tool calls occur.
		case "turn_start":
			turnCount++;
			if (streamBuffer) {
				console.log();
				streamBuffer = "";
			}
			console.log(`[TURN START] turn #${turnCount}`);
			break;

		case "turn_end":
			break;

		// ── Message lifecycle ──
		case "message_start":
			break;

		case "message_update": {
			// Streaming delta events from the LLM.
			// assistantMessageEvent contains the granular streaming event.
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent.type === "text_delta") {
				if (!streamBuffer) {
					process.stdout.write("[STREAMING] ");
				}
				process.stdout.write(assistantEvent.delta);
				streamBuffer += assistantEvent.delta;
			}
			break;
		}

		case "message_end":
			if (streamBuffer) {
				console.log();
				streamBuffer = "";
			}
			break;

		// ── Tool execution lifecycle ──
		// These events fire when the agent calls a tool.
		// The inner loop: assistant response -> tool call -> tool result -> next assistant response
		case "tool_execution_start":
			console.log(`[TOOL CALL] ${event.toolName} (id: ${event.toolCallId})`);
			break;

		case "tool_execution_update":
			// Partial results from long-running tools (not used in this example)
			break;

		case "tool_execution_end": {
			const resultText = event.result.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");
			const label = event.isError ? "[TOOL ERROR]" : "[TOOL RESULT]";
			console.log(`${label} ${resultText}`);
			break;
		}
	}
}
