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
const PARENT_MODEL_ID = process.env.LOCAL_PARENT_MODEL ?? process.env.LOCAL_LLM_MODEL ?? "gpt-5";
const SUBAGENT_MODEL_ID = process.env.LOCAL_SUBAGENT_MODEL ?? "claude-haiku-4.5";
const BASELINE_PARENT_MODEL_ID = process.env.LOCAL_BASELINE_PARENT_MODEL ?? "claude-haiku-4.5";

const baseRef = getModel("openrouter", "openai/gpt-4o");
function createLocalProxyModel(modelId: string) {
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

const parentProxyModel = createLocalProxyModel(PARENT_MODEL_ID);
const subagentProxyModel = createLocalProxyModel(SUBAGENT_MODEL_ID);

interface DemoOptions {
	parentModelId: string;
	subagentModelId: string;
	topic?: string;
	runComparison: boolean;
}

interface DemoRunSummary {
	label: string;
	parentModelId: string;
	subagentModelId: string;
	finalSynthesis: string;
	toolCalls: number;
}

function parseArgs(argv: string[]): DemoOptions {
	const options: DemoOptions = {
		parentModelId: PARENT_MODEL_ID,
		subagentModelId: SUBAGENT_MODEL_ID,
		topic: undefined,
		runComparison: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--parent-model") {
			options.parentModelId = argv[++i] ?? options.parentModelId;
		} else if (arg === "--subagent-model") {
			options.subagentModelId = argv[++i] ?? options.subagentModelId;
		} else if (arg === "--topic") {
			options.topic = argv[++i] ?? options.topic;
		} else if (arg === "--compare") {
			options.runComparison = true;
		}
	}

	return options;
}

function buildDefaultPrompt(topic?: string): string {
	if (topic) {
		return (
			`Assess how clear or likely ${topic} is in the near term from exactly 3 perspectives. ` +
			"Call `ask_reviewer` 3 times with these personas:\n" +
			"1. An escalation-risk analyst who focuses on signals that increase the chance of open conflict\n" +
			"2. A cautious diplomatic analyst who focuses on deterrence, signaling, and off-ramps\n" +
			"3. A market-impact analyst who only cares about what would have to happen before markets price in real escalation\n\n" +
			"Each review should be 2-3 sentences. Focus on reasoning patterns and decision signals, not unverifiable claims. " +
			'After collecting all 3, write a synthesis of how "clear" the trajectory really is.'
		);
	}

	return (
		"Assess how clear or likely a U.S.-Iran war is in the near term from exactly 3 perspectives. " +
		"Call `ask_reviewer` 3 times with these personas:\n" +
		"1. An escalation-risk analyst who focuses on signals that increase the chance of open conflict\n" +
		"2. A cautious diplomatic analyst who focuses on deterrence, signaling, and off-ramps\n" +
		"3. A market-impact analyst who only cares about what would have to happen before markets price in real escalation\n\n" +
		"Each review should be 2-3 sentences. Focus on reasoning patterns and decision signals, not unverifiable claims. " +
		'After collecting all 3, write a synthesis of how "clear" the trajectory really is.'
	);
}

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

function createReviewerTool(subagentModelId: string): AgentTool<typeof reviewerSchema> {
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
			console.log(`   Model: ${subagentModelId}`);
			console.log(`   Messages: [] (empty = isolated)`);
			console.log(`${"─".repeat(60)}`);

			// ── THE ISOLATED SUBAGENT ──
			// 🔑 Each one gets its own persona as system prompt.
			// Agent A is a superfan. Agent B is a hater. They never see each other.
			const subagent = new Agent({
				initialState: {
					systemPrompt: params.persona,  // ← DIFFERENT for each subagent!
					model: createLocalProxyModel(subagentModelId),
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

async function runDemo(
	label: string,
	parentModelId: string,
	subagentModelId: string,
	userPrompt: string,
): Promise<DemoRunSummary> {
	console.log("═".repeat(60));
	console.log(` 🎓 SUBAGENT PERSPECTIVES DEMO${label ? ` — ${label}` : ""}`);
	console.log(" Why one agent can't do what three isolated subagents can");
	console.log("═".repeat(60));
	let finalSynthesis = "";
	let toolCalls = 0;

	const parentAgent = new Agent({
		initialState: {
			systemPrompt:
				"You are a product research coordinator. You have access to the `ask_reviewer` tool " +
				"which spawns isolated reviewer agents. Each reviewer has its own independent system prompt " +
				"and memory — they cannot see each other's reviews.\n\n" +
				"When asked to review a product from multiple perspectives, you MUST call `ask_reviewer` " +
				"separately for EACH perspective. Give each reviewer a very different persona in the `persona` field. " +
				"After all reviews are collected, write a brief synthesis comparing the different perspectives.",
			model: createLocalProxyModel(parentModelId),
			thinkingLevel: "off",
			tools: [createReviewerTool(subagentModelId)],
			messages: [],
		},
		getApiKey: async () => LOCAL_API_KEY,
	});

	// Print system prompt for transparency
	console.log(`\n📋 PARENT SYSTEM PROMPT:`);
	console.log(`   "${parentAgent.state.systemPrompt?.substring(0, 200)}..."\n`);
	console.log(`📋 MODEL SPLIT:`);
	console.log(`   Parent model: ${parentModelId}`);
	console.log(`   Subagent model: ${subagentModelId}\n`);

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
				if (nTools > 0) {
					toolCalls = nTools;
					console.log(`   → LLM chose to call ${nTools} tool(s)`);
				}
					if (msg.stopReason === "error") console.log(`   ❌ Error: ${msg.errorMessage}`);
					if (text.trim()) {
					finalSynthesis = text;
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


	console.log(`👤 User: ${userPrompt}\n`);
	await parentAgent.prompt(userPrompt);
	console.log("\n✅ Done!");

	return {
		label,
		parentModelId,
		subagentModelId,
		finalSynthesis,
		toolCalls,
	};
}

function printComparisonSummary(results: DemoRunSummary[]): void {
	console.log(`\n${"═".repeat(60)}`);
	console.log(" 📊 A/B SUMMARY");
	console.log("═".repeat(60));
	for (const result of results) {
		const preview = result.finalSynthesis.replace(/\s+/g, " ").trim().slice(0, 180);
		console.log(`- ${result.label}`);
		console.log(`  parent=${result.parentModelId}, subagent=${result.subagentModelId}, toolCalls=${result.toolCalls}`);
		console.log(`  synthesis=${preview}${result.finalSynthesis.length > 180 ? "..." : ""}`);
	}
	console.log("═".repeat(60));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const userPrompt = buildDefaultPrompt(options.topic);

	if (options.runComparison) {
		const baseline = await runDemo("baseline", BASELINE_PARENT_MODEL_ID, options.subagentModelId, userPrompt);
		console.log("\n\n");
		const improved = await runDemo("improved", options.parentModelId, options.subagentModelId, userPrompt);
		printComparisonSummary([baseline, improved]);
		return;
	}

	await runDemo("", options.parentModelId, options.subagentModelId, userPrompt);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
