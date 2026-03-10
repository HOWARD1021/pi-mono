/**
 * 🎓 LEARNING FILE: subagent-hello.ts
 *
 * CONCEPT: Parent agent + Subagent pattern
 *
 * What you will see happen when you run this:
 *   1. A PARENT agent is created with a "subagent" tool in its toolkit.
 *   2. You give the parent agent a task.
 *   3. The parent agent decides to call the "subagent" tool.
 *   4. Inside that tool, a brand new SUBAGENT is created with a fresh, empty memory.
 *   5. The subagent does its own individual task (the inner loop runs).
 *   6. The subagent's final message is collected and returned to the PARENT as a tool result.
 *   7. The parent uses that result to form its final answer.
 *
 * This demonstrates THREE key skills from the week-1 plan:
 *  - Subagent ISOLATION (fresh context = clean slate)
 *  - Context INDEPENDENCE (parent's history invisible to child)
 *  - Tool-based COORDINATION (parent delegates, child executes, result flows back up)
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Agent core: the loop, tool types, message types
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";

// pi-ai: getModel gives us a typed model descriptor.
// The loop calls getModel(...) and passes it to the LLM stream function.
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";

// TypeBox is how we define the tool's input schema so the LLM knows exactly
// what JSON to send when it calls the tool.
import { Type, type Static } from "@sinclair/typebox";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL PROXY MODEL
//
// 🔑 KEY LEARNING: A Model in pi-ai is just a plain object (not a class).
// This means we can take a known model definition and SPREAD it to override
// specific fields — like swapping the baseUrl and apiKey to point at your
// local proxy (the same endpoint executor.ts uses).
//
// This is exactly the same pattern as:
//   const DEFAULT_API_BASE = "http://localhost:8317/v1";
//   const DEFAULT_API_KEY  = "quotio-local-716AEC5B";
// from executor.ts, just in the pi-ai model format.
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_API_BASE = process.env.LOCAL_LLM_API_BASE ?? "http://localhost:8317/v1";
const LOCAL_API_KEY  = process.env.LOCAL_LLM_API_KEY  ?? "quotio-local-716AEC5B";
// 💡 LESSON: always check /v1/models to see what IDs your proxy actually serves!
// curl http://localhost:8317/v1/models -H "Authorization: Bearer quotio-local-716AEC5B"
// The proxy serves "claude-haiku-4.5", NOT "claude/haiku" or "google/gemini-2.5-flash"
const LOCAL_MODEL_ID = process.env.LOCAL_LLM_MODEL    ?? "claude-haiku-4.5";

// We start from the openrouter gpt-4o definition as a base (same openai-completions API)
// but OVERRIDE compat to be minimal for a plain local proxy.
//
// 🔑 WHY THIS MATTERS:
// The openrouter compat adds params like `store: false` and `stream_options: {include_usage:true}`
// that a bare local proxy (like LiteLLM or your quotio proxy) will reject or silently drop,
// causing the LLM to return an empty response. We set them all to false/off.
const baseRef = getModel("openrouter", "openai/gpt-4o");
const localProxyModel = {
	...baseRef,
	provider: "openrouter" as const,
	id: LOCAL_MODEL_ID,
	baseUrl: LOCAL_API_BASE,
	// Minimal compat: only what a standard OpenAI-compatible endpoint needs
	compat: {
		...baseRef.compat,
		supportsStore: false,            // ← don't send 'store: false' to local proxy
		supportsUsageInStreaming: false, // ← don't send 'stream_options' to local proxy
		supportsDeveloperRole: false,   // ← use 'system' role, not 'developer'
		supportsReasoningEffort: false, // ← no reasoning_effort param
		supportsStrictMode: false,      // ← no 'strict' in tool schemas
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Define the Subagent Tool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 📐 Input Schema
 *
 * This is the "prep ticket" the Head Chef writes.
 * The LLM reads this schema to know: "When I call `ask_subagent`, I must provide
 * a `task` field that is a string."
 *
 * Type.Object() → produces a JSON Schema object
 * Type.String()  → the value must be a plain string
 */
const subagentSchema = Type.Object({
	task: Type.String({
		description:
			"A clear, self-contained task for the subagent. Include all needed context — the subagent has NO memory of prior conversations.",
	}),
});

// This gives us a TypeScript type from the schema above, so the `execute`
// function is type-safe: we know `params.task` is always a string.
type SubagentInput = Static<typeof subagentSchema>;

/**
 * 🔧 createSubagentTool()
 *
 * A factory function. We call it once at startup with the model we want the
 * subagent to use. It returns an `AgentTool` object.
 *
 * Why a factory? So we can easily swap models, or create multiple flavours of
 * subagent tools (fast-subagent, careful-subagent, etc.)
 */
function createSubagentTool(): AgentTool<typeof subagentSchema> {
	return {
		// ── IDENTITY ──
		// `name` must match what will be shown in the LLM's tool-call JSON.
		// The LLM literally writes `"name": "ask_subagent"` when it calls this.
		name: "ask_subagent",
		label: "Ask Subagent", // Human-readable label for UIs

		// ── DESCRIPTION ──
		// THIS IS THE MOST IMPORTANT FIELD.
		// The LLM reads this description to decide WHEN to use the tool.
		// Be explicit and honest about what it does and does NOT have access to.
		description:
			"Delegates a task to an isolated subagent with a fresh memory. " +
			"The subagent cannot see the current conversation. You must include all " +
			"context it needs inside the `task` field. Use this to offload a well-defined " +
			"sub-task and keep your own context window clean.",

		// ── SCHEMA ──
		// Tells the LLM framework what JSON shape to send for this tool call.
		parameters: subagentSchema,

		// ── EXECUTE ──
		// This is YOUR code. The agent-loop calls this when the LLM picks this tool.
		//
		// Arguments:
		//  toolCallId  – unique ID for this call (used for streaming updates)
		//  params      – the validated, typed input from the LLM
		//  signal      – AbortSignal (honours Ctrl+C / parent abort)
		//  onUpdate    – optional callback to send live progress updates to the parent
		execute: async (
			_toolCallId: string,
			params: SubagentInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback,
		): Promise<AgentToolResult<{ subagentMessages: number }>> => {

			// ── LIVE STATUS UPDATE ──
			// Call onUpdate() any time you want to give the PARENT agent a preview
			// of what's happening. This shows up in the UI while the tool is running.
			onUpdate?.({
				content: [{ type: "text", text: `⏳ Subagent is working on: "${params.task}"` }],
				details: { subagentMessages: 0 },
			});

			// ── CREATE THE SUBAGENT ──
			//
			// 🔑 KEY LEARNING POINT: `messages: []`
			// This is the entire secret to isolation. We start with an EMPTY history.
			// The subagent has ZERO knowledge of how it was created, who the parent is,
			// or what happened before. It only knows its systemPrompt and the `task`
			// we are about to give it.
			//
			// Compare this to how AgentSession works: it loads past messages from disk.
			// Here, we deliberately give it nothing. Clean slate = Sous Chef's clean station.
			const subagent = new Agent({
				initialState: {
					systemPrompt: [
						"You are a focused subagent. A higher-level agent has delegated a specific task to you.",
						"Complete it thoroughly. When you are done, summarise exactly what you accomplished.",
					].join("\n"),
					// 🔑 Use the same local proxy model, but we could use a different/cheaper
					// model for subagents than the parent — that's the power of the factory pattern.
					model: localProxyModel,
					thinkingLevel: "off",
					tools: [],      // ← For this hello-world, no tools. Just pure LLM reasoning.
					messages: [],   // ← 🔑 EMPTY = fresh, isolated context
				},
				// The Agent also needs to know how to resolve the API key.
				// getApiKey() is called before each LLM request.
				getApiKey: async () => LOCAL_API_KEY,
			});

			// ── RUN THE SUBAGENT ──
			//
			// This calls agentLoop() internally (via Agent._runLoop()).
			// The subagent will go through its own inner loop until it stops.
			// We simply await it — the parent agent is BLOCKED here waiting for the result.
			// (In a real system, you might want timeouts or parallel subagents.)
			await subagent.prompt(params.task, undefined);

			// ── EXTRACT THE RESULT ──
			//
			// After the loop finishes, all messages are in `subagent.state.messages`.
			// We scan from the END to find the last assistant message — that's the
			// subagent's "final answer".
			const messages = subagent.state.messages;
			let finalOutput = "(Subagent produced no text output)";

			for (let i = messages.length - 1; i >= 0; i--) {
				const msg = messages[i];
				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					const text = msg.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text as string)
						.join("")
						.trim();
					if (text) {
						finalOutput = text;
						break;
					}
				}
			}

			// ── RETURN THE RESULT ──
			//
			// This goes back to the parent agent's loop as a ToolResultMessage.
			// The parent's LLM will read it in the next turn and incorporate it
			// into its own reasoning — just like a chef reading a prep report.
			return {
				content: [{ type: "text", text: `Subagent result:\n\n${finalOutput}` }],
				details: { subagentMessages: messages.length },
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Create the Parent Agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🎯 MAIN
 *
 * We create the PARENT agent here.
 * Note: the PARENT has `ask_subagent` in its tools list.
 *       The SUBAGENT (created inside the tool) has NO tools.
 *
 * This asymmetry is intentional: the parent delegates, the subagent thinks.
 */
async function main() {
	console.log("=== Subagent Hello World ===\n");

	// Create the parent agent with the subagent tool available
	const parentAgent = new Agent({
		initialState: {
			systemPrompt:
				"You are a helpful assistant. When asked to demonstrate how subagents work, " +
				"use the `ask_subagent` tool to delegate a small, concrete task and then " +
				"report back what the subagent returned.",
			// 🔑 Same local proxy model for the parent.
			// In a real system you could use a smarter model for the parent (orchestrator)
			// and a faster/cheaper model for the subagents (workers).
			model: localProxyModel,
			thinkingLevel: "off",
			tools: [createSubagentTool()], // ← The parent knows about the tool; the subagent doesn't
			messages: [],
		},
		getApiKey: async () => LOCAL_API_KEY,
	});

	// 🔍 VERBOSE subscriber — prints EVERY event so you can see the full loop
	// This is exactly how you would debug or monitor an agent in production.
	parentAgent.subscribe((event) => {
		switch (event.type) {
			case "agent_start":
				console.log("\n📣 agent_start — loop beginning");
				break;
			case "turn_start":
				console.log("🔄 turn_start — asking LLM...");
				break;
			case "message_start":
				console.log(`✉️  message_start role=${event.message.role}`);
				break;
			case "message_end": {
				const msg = event.message as any;
				if (msg.role === "assistant") {
					const text = (msg.content ?? [])
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text as string)
						.join("");
					const nTools = (msg.content ?? []).filter((c: any) => c.type === "toolCall").length;
					// 🔑 KEY: this raw log shows us what the LLM actually returned
					console.log(`✉️  message_end  role=assistant stopReason=${msg.stopReason} toolCalls=${nTools} textLen=${text.length}`);
					// If there was an error, print the error message from the proxy
					if (msg.stopReason === "error") {
						console.log(`   ❌ errorMessage: ${msg.errorMessage}`);
					}
					if (text.trim()) console.log(`\n🤖 Parent says:\n${text}\n`);
				} else {
					console.log(`✉️  message_end  role=${msg.role}`);
				}
				break;
			}
			case "turn_end":
				console.log(`🔄 turn_end`);
				break;
			case "tool_execution_start":
				console.log(`\n🔧 tool_execution_start  tool=${event.toolName}`);
				console.log(`   args=${JSON.stringify(event.args)}`);
				break;
			case "tool_execution_end":
				console.log(`✅ tool_execution_end  tool=${event.toolName} isError=${event.isError}`);
				if (event.isError) console.log(`   ERROR: ${JSON.stringify((event as any).result)}`);
				break;
			case "agent_end":
				console.log(`\n📣 agent_end — ${event.messages.length} new message(s) this run`);
				break;
		}
	});

	// Force tool use explicitly in the prompt.
	// If the model still skips the tool, we know it's a model-level issue not a code issue.
	const userPrompt =
		"You MUST call the `ask_subagent` tool. " +
		'Task to delegate: "Write a one-sentence hello world message and explain in one sentence what you are." ' +
		"After the tool returns, report what the subagent said.";

	console.log(`👤 User: ${userPrompt}\n`);
	await parentAgent.prompt(userPrompt);
	console.log("\n=== Done ===");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
