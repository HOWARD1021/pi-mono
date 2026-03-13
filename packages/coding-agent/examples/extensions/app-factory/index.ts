/**
 * App Factory Extension
 *
 * OpenSpec-aligned workflow for bootstrapping reusable fullstack application
 * changes from intake through approval and task execution.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	type AppFactoryIntake,
	type AppFactoryWorkflowState,
	approveAppFactorySpec,
	archiveAppFactoryChange,
	blockAppFactoryTask,
	completeAppFactoryTask,
	createAppFactoryChange,
	generateAppFactoryArtifacts,
	loadAppFactoryState,
	markRetroComplete,
	renderExecutionPrompt,
	renderRetroPrompt,
	renderVerifyPrompt,
	startNextAppFactoryTask,
	summarizeAppFactoryState,
	syncAppFactoryArtifacts,
	updateAppFactoryIntake,
} from "../../../src/workflows/app-factory/index.js";

interface AppFactorySessionState {
	currentChangeId?: string;
	executingTaskId?: string;
}

const SESSION_CUSTOM_TYPE = "app-factory-session";

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function extractMarkerIds(text: string, kind: "DONE" | "BLOCKED"): string[] {
	const regex = new RegExp(`\\[APP_TASK_${kind}:([^\\]]+)\\]`, "gi");
	const ids = new Set<string>();
	for (const match of text.matchAll(regex)) {
		const id = match[1]?.trim();
		if (id) ids.add(id);
	}
	return [...ids];
}

function listKnownChanges(cwd: string): string[] {
	const changesDir = join(cwd, "openspec", "changes");
	if (!existsSync(changesDir)) return [];
	return readdirSync(changesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "archive")
		.map((entry) => entry.name)
		.filter((name) => existsSync(join(changesDir, name, "workflow.json")))
		.sort();
}

export default function appFactoryExtension(pi: ExtensionAPI): void {
	let currentChangeId: string | undefined;
	let executingTaskId: string | undefined;

	function persistSessionState(): void {
		pi.appendEntry(SESSION_CUSTOM_TYPE, {
			currentChangeId,
			executingTaskId,
		} satisfies AppFactorySessionState);
	}

	function setActiveChange(changeId: string | undefined): void {
		currentChangeId = changeId;
		persistSessionState();
	}

	function setExecutingTask(taskId: string | undefined): void {
		executingTaskId = taskId;
		persistSessionState();
	}

	async function resolveWorkflow(ctx: ExtensionContext): Promise<AppFactoryWorkflowState> {
		if (currentChangeId) {
			return loadAppFactoryState(ctx.cwd, currentChangeId);
		}

		const knownChanges = listKnownChanges(ctx.cwd);
		if (knownChanges.length === 0) {
			throw new Error("No app-factory change found. Start with /app:new <change-id>.");
		}

		const selected = await ctx.ui.select("Select app-factory change", knownChanges);
		if (!selected) {
			throw new Error("No change selected.");
		}
		currentChangeId = selected;
		persistSessionState();
		return loadAppFactoryState(ctx.cwd, selected);
	}

	pi.registerCommand("app:new", {
		description: "Create a new OpenSpec-style app-factory change",
		handler: async (args, ctx) => {
			const requested = args.trim() || (await ctx.ui.input("New change id", "app-factory-change"))?.trim();
			if (!requested) {
				ctx.ui.notify("Change creation cancelled.", "warning");
				return;
			}

			const appName = (await ctx.ui.input("App name", requested))?.trim() || requested;
			const state = createAppFactoryChange(ctx.cwd, requested, { appName });
			setActiveChange(state.changeId);
			setExecutingTask(undefined);
			ctx.ui.notify(`Created app-factory change '${state.changeId}'`, "info");
			pi.sendMessage(
				{
					customType: "app-factory-created",
					content: `App factory change created.\n\n${summarizeAppFactoryState(state)}\n\nNext: run /app:intake`,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("app:intake", {
		description: "Capture concept, purpose, stack notes, and UI references",
		handler: async (_args, ctx) => {
			const state = await resolveWorkflow(ctx);
			const existing = state.intake;

			const appName = await ctx.ui.input("App name", existing?.appName ?? state.changeId);
			if (!appName?.trim()) {
				ctx.ui.notify("App intake cancelled.", "warning");
				return;
			}
			const concept = await ctx.ui.editor("Concept", existing?.concept ?? "");
			if (!concept?.trim()) {
				ctx.ui.notify("Concept is required to capture intake.", "warning");
				return;
			}
			const purpose = await ctx.ui.editor("Main purpose", existing?.purpose ?? "");
			if (!purpose?.trim()) {
				ctx.ui.notify("Main purpose is required to capture intake.", "warning");
				return;
			}
			const stackNotes = await ctx.ui.editor(
				"Stack notes",
				existing?.stackNotes ??
					[
						"Frontend: Next.js + Tailwind",
						"Backend: Cloudflare Workers + Hono",
						"Auth: BetterAuth",
						"Billing: Stripe",
						"Note any deviations or additional requirements here.",
					].join("\n"),
			);
			const uiuxReferences = await ctx.ui.editor("UI/UX references", existing?.uiuxReferences ?? "");
			const referenceNotes = await ctx.ui.editor("Reference notes", existing?.referenceNotes ?? "");

			const nextIntake: AppFactoryIntake = {
				appName: appName.trim(),
				concept: concept.trim(),
				purpose: purpose.trim(),
				stackNotes: stackNotes?.trim() ?? "",
				uiuxReferences: uiuxReferences?.trim() ?? "",
				referenceNotes: referenceNotes?.trim() ?? "",
			};
			const updated = updateAppFactoryIntake(state, nextIntake);
			setActiveChange(updated.changeId);
			ctx.ui.notify(`Captured intake for '${updated.changeId}'`, "info");
			pi.sendMessage(
				{
					customType: "app-factory-intake",
					content: `Intake captured for ${updated.changeId}.\n\nNext: run /app:spec to generate OpenSpec artifacts.`,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("app:spec", {
		description: "Generate proposal, design, spec, tasks, acceptance, and retro artifacts",
		handler: async (_args, ctx) => {
			const state = await resolveWorkflow(ctx);
			const updated = syncAppFactoryArtifacts(generateAppFactoryArtifacts(state));
			setActiveChange(updated.changeId);
			ctx.ui.notify(`Generated spec artifacts for '${updated.changeId}'`, "info");
			pi.sendMessage(
				{
					customType: "app-factory-spec",
					content: [
						{ type: "text", text: `Generated OpenSpec artifacts for ${updated.changeId}.` },
						{ type: "text", text: `Proposal: ${updated.paths.proposalPath}` },
						{ type: "text", text: `Design: ${updated.paths.designPath}` },
						{ type: "text", text: `Spec: ${updated.paths.specPath}` },
						{ type: "text", text: `Tasks: ${updated.paths.tasksPath}` },
						{ type: "text", text: `Next: review the artifacts, then run /app:approve` },
					],
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("app:approve", {
		description: "Approve the generated app-factory spec before implementation",
		handler: async (_args, ctx) => {
			const state = await resolveWorkflow(ctx);
			const confirmed = await ctx.ui.confirm(
				"Approve app-factory spec",
				`Approve change '${state.changeId}' and unlock /app:apply?`,
			);
			if (!confirmed) return;
			const updated = approveAppFactorySpec(state);
			setActiveChange(updated.changeId);
			ctx.ui.notify(`Approved spec for '${updated.changeId}'`, "info");
		},
	});

	pi.registerCommand("app:status", {
		description: "Show the current app-factory workflow summary",
		handler: async (_args, ctx) => {
			const state = await resolveWorkflow(ctx);
			pi.sendMessage(
				{
					customType: "app-factory-status",
					content: `${summarizeAppFactoryState(state)}\n\nTasks file: ${state.paths.tasksPath}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("app:apply", {
		description: "Execute the next approved task in the app-factory workflow",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before starting the next app task.", "warning");
				return;
			}
			const state = await resolveWorkflow(ctx);
			if (state.stage !== "approved" && state.stage !== "implementing" && state.stage !== "verified") {
				ctx.ui.notify("Approve the spec first with /app:approve.", "warning");
				return;
			}

			const updated = syncAppFactoryArtifacts(startNextAppFactoryTask(state));
			if (!updated.currentTaskId) {
				ctx.ui.notify("All workflow tasks are already complete.", "info");
				return;
			}
			const task = updated.tasks.find((item) => item.id === updated.currentTaskId);
			if (!task) {
				ctx.ui.notify(`Current task '${updated.currentTaskId}' could not be loaded.`, "error");
				return;
			}
			setActiveChange(updated.changeId);
			setExecutingTask(task.id);
			pi.sendUserMessage(renderExecutionPrompt(updated, task));
		},
	});

	pi.registerCommand("app:verify", {
		description: "Ask the agent to verify the change against spec and acceptance artifacts",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before verification.", "warning");
				return;
			}
			const state = await resolveWorkflow(ctx);
			setActiveChange(state.changeId);
			pi.sendUserMessage(renderVerifyPrompt(state));
		},
	});

	pi.registerCommand("app:retro", {
		description: "Ask the agent for a retrospective and mark retro stage active",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before running retro.", "warning");
				return;
			}
			const state = await resolveWorkflow(ctx);
			const updated = syncAppFactoryArtifacts(markRetroComplete(state));
			setActiveChange(updated.changeId);
			pi.sendUserMessage(renderRetroPrompt(updated));
		},
	});

	pi.registerCommand("app:archive", {
		description: "Archive the current app-factory change",
		handler: async (_args, ctx) => {
			const state = await resolveWorkflow(ctx);
			const unfinished = state.tasks.filter((task) => task.status !== "done");
			const confirmed = await ctx.ui.confirm(
				"Archive app-factory change",
				unfinished.length > 0
					? `There are ${unfinished.length} unfinished task(s). Archive anyway?`
					: `Archive '${state.changeId}' into openspec/changes/archive?`,
			);
			if (!confirmed) return;
			const archived = archiveAppFactoryChange(state);
			setActiveChange(undefined);
			setExecutingTask(undefined);
			ctx.ui.notify(`Archived '${archived.changeId}'`, "info");
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!currentChangeId || !executingTaskId) return;
		const state = loadAppFactoryState(ctx.cwd, currentChangeId);
		const task = state.tasks.find((item) => item.id === executingTaskId);
		if (!task) return;
		return {
			message: {
				customType: "app-factory-context",
				content: `App-factory execution context:
- Change: ${state.changeId}
- Stage: ${state.stage}
- Current task: ${task.id} ${task.title}
- External truth: ${state.paths.tasksPath}, ${state.paths.specPath}, ${state.paths.acceptancePath}
- Stay within the current task boundary and emit the required APP_TASK marker.`,
				display: false,
			},
		};
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!currentChangeId || !executingTaskId) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		const doneIds = extractMarkerIds(text, "DONE");
		const blockedIds = extractMarkerIds(text, "BLOCKED");

		if (doneIds.includes(executingTaskId)) {
			let state = loadAppFactoryState(ctx.cwd, currentChangeId);
			state = syncAppFactoryArtifacts(
				completeAppFactoryTask(state, executingTaskId, "Completed via /app:apply execution marker."),
			);
			setExecutingTask(undefined);
			ctx.ui.notify(`Marked task ${doneIds[0]} complete`, "info");
			pi.sendMessage(
				{
					customType: "app-factory-task-done",
					content: `Task ${doneIds[0]} complete.\n\nRun /app:apply to continue or /app:verify to review the change.`,
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		if (blockedIds.includes(executingTaskId)) {
			let state = loadAppFactoryState(ctx.cwd, currentChangeId);
			state = syncAppFactoryArtifacts(
				blockAppFactoryTask(state, executingTaskId, "Blocked via /app:apply execution marker."),
			);
			setExecutingTask(undefined);
			ctx.ui.notify(`Marked task ${blockedIds[0]} blocked`, "warning");
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const entry = ctx.sessionManager
			.getEntries()
			.filter(
				(item: { type: string; customType?: string }) =>
					item.type === "custom" && item.customType === SESSION_CUSTOM_TYPE,
			)
			.pop() as { data?: AppFactorySessionState } | undefined;

		currentChangeId = entry?.data?.currentChangeId;
		executingTaskId = entry?.data?.executingTaskId;

		if (!currentChangeId) {
			const changes = listKnownChanges(ctx.cwd);
			if (changes.length === 1) {
				currentChangeId = changes[0];
			}
		}
		persistSessionState();
	});
}
