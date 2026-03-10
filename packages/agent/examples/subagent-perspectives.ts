/**
 * 🎓 LESSON: WHY Subagents Matter — Context Isolation in Action
 *
 * THE PROBLEM WITH ONE AGENT:
 * If you ask ONE agent to "write a 5-star review, then a 1-star review",
 * the positive tone from the first review BLEEDS into the second.
 * The LLM can see its own previous enthusiastic output and struggles
 * to fully switch to a harsh critic tone. This is called "context contamination".
 *
 * THE SUBAGENT SOLUTION:
 * Each reviewer is a SEPARATE subagent with:
 *  - Its own system prompt (persona)
 *  - Its own empty message history (no memory of other reviews)
 *  - Total isolation from each other
 *
 * Run this and compare the output quality. A single agent's 1-star review
 * would be softer because it just wrote glowing praise 2 seconds ago.
 * The isolated subagent's 1-star review is genuinely harsh.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

// ─── Local proxy config (same as hello world) ───
const LOCAL_API_BASE = process.env.LOCAL_LLM_API_BASE ?? "http://localhost:8317/v1";
const LOCAL_API_KEY  = process.env.LOCAL_LLM_API_KEY  ?? "quotio-local-716AEC5B";
const LOCAL_MODEL_ID = process.env.LOCAL_LLM_MODEL    ?? "claude-haiku-4.5";

const baseRef = getModel("openrouter", "openai/gpt-4o");
const localProxyModel = {
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

// ─────────────────────────────────────────────────────────────────────────────
// THE TOOL: ask_reviewer
//
// 🔑 KEY DIFFERENCE from hello world:
// This tool takes BOTH a `persona` (system prompt) AND a `task`.
// Each subagent gets a DIFFERENT system prompt = DIFFERENT personality.
// This is impossible with a single agent, because one agent = one system prompt.
// ─────────────────────────────────────────────────────────────────────────────

const reviewerSchema = Type.Object({
	persona: Type.String({
		description: "The system prompt that defines this reviewer's personality and perspective. Be specific about their tone, bias, and writing style.",
	}),
	task: Type.String({
		description: "The review task to complete. Include the product name and any specific requirements.",
	}),
});

type ReviewerInput = Static<typeof reviewerSchema>;

function createReviewerTool(): AgentTool<typeof reviewerSchema> {
	return {
		name: "ask_reviewer",
		label: "Ask Reviewer",
		description:
			"Spawns an isolated reviewer subagent with a specific persona (system prompt) and task. " +
			"Each reviewer has completely fresh memory and cannot see other reviewers' output. " +
			"Use this to get genuinely independent perspectives.",
		parameters: reviewerSchema,
		execute: async (
			_toolCallId: string,
			params: ReviewerInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback,
		): Promise<AgentToolResult<{ persona: string; messageCount: number }>> => {

			// ┌──────────────────────────────────────────────────────────┐
			// │  🔍 TRANSPARENCY: Print exactly what is being created   │
			// └──────────────────────────────────────────────────────────┘
			console.log(`\n${"─".repeat(60)}`);
			console.log(`📋 SUBAGENT CREATION DETAILS:`);
			console.log(`   System Prompt: "${params.persona}"`);
			console.log(`   Task: "${params.task}"`);
			console.log(`   Model: ${LOCAL_MODEL_ID}`);
			console.log(`   Messages: [] (empty = isolated)`);
			console.log(`${"─".repeat(60)}`);

			// ── THE ISOLATED SUBAGENT ──
			// 🔑 Each one gets its own persona as system prompt.
			// Agent A is a superfan. Agent B is a hater. They never see each other.
			const subagent = new Agent({
				initialState: {
					systemPrompt: params.persona,  // ← DIFFERENT for each subagent!
					model: localProxyModel,
					thinkingLevel: "off",
					tools: [],
					messages: [],  // ← ALWAYS empty = fresh, isolated
				},
				getApiKey: async () => LOCAL_API_KEY,
			});

			await subagent.prompt(params.task, undefined);

			// Extract final text
			const messages = subagent.state.messages;
			let finalOutput = "(no output)";
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

			console.log(`\n📤 SUBAGENT OUTPUT (${finalOutput.length} chars):`);
			console.log(`   "${finalOutput.substring(0, 150)}..."\n`);

			return {
				content: [{ type: "text", text: finalOutput }],
				details: { persona: params.persona.substring(0, 50), messageCount: messages.length },
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — the parent orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log("═".repeat(60));
	console.log(" 🎓 SUBAGENT PERSPECTIVES DEMO");
	console.log(" Why one agent can't do what three isolated subagents can");
	console.log("═".repeat(60));

	const parentAgent = new Agent({
		initialState: {
			systemPrompt:
				"You are a product research coordinator. You have access to the `ask_reviewer` tool " +
				"which spawns isolated reviewer agents. Each reviewer has its own independent system prompt " +
				"and memory — they cannot see each other's reviews.\n\n" +
				"When asked to review a product from multiple perspectives, you MUST call `ask_reviewer` " +
				"separately for EACH perspective. Give each reviewer a very different persona in the `persona` field. " +
				"After all reviews are collected, write a brief synthesis comparing the different perspectives.",
			model: localProxyModel,
			thinkingLevel: "off",
			tools: [createReviewerTool()],
			messages: [],
		},
		getApiKey: async () => LOCAL_API_KEY,
	});

	// Print system prompt for transparency
	console.log(`\n📋 PARENT SYSTEM PROMPT:`);
	console.log(`   "${parentAgent.state.systemPrompt?.substring(0, 200)}..."\n`);

	// Event logging
	parentAgent.subscribe((event) => {
		switch (event.type) {
			case "turn_start":
				console.log("\n🔄 Parent: asking LLM...");
				break;
			case "message_end": {
				const msg = event.message as any;
				if (msg.role === "assistant") {
					const nTools = (msg.content ?? []).filter((c: any) => c.type === "toolCall").length;
					const text = (msg.content ?? [])
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("");
					if (nTools > 0) console.log(`   → LLM chose to call ${nTools} tool(s)`);
					if (msg.stopReason === "error") console.log(`   ❌ Error: ${msg.errorMessage}`);
					if (text.trim()) {
						console.log(`\n${"═".repeat(60)}`);
						console.log(" 🤖 PARENT'S FINAL SYNTHESIS:");
						console.log("═".repeat(60));
						console.log(text);
						console.log("═".repeat(60));
					}
				}
				break;
			}
			case "tool_execution_start":
				console.log(`\n🔧 Spawning reviewer: ${JSON.stringify((event.args as any)?.persona?.substring(0, 60))}...`);
				break;
		}
	});

	// THE TASK: Three isolated, contradicting perspectives
	const userPrompt =
		"Review the product 'iPhone 15 Pro Max' from exactly 3 perspectives. " +
		"Call `ask_reviewer` 3 times with these personas:\n" +
		"1. A die-hard Apple superfan who thinks everything Apple makes is perfect\n" +
		"2. A harsh tech critic who is deeply skeptical of Apple and finds flaws in everything\n" +
		"3. A budget-conscious parent who only cares about value for money\n\n" +
		"Each review should be 2-3 sentences. After collecting all 3, write a synthesis.";

	console.log(`👤 User: ${userPrompt}\n`);
	await parentAgent.prompt(userPrompt);
	console.log("\n✅ Done!");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
