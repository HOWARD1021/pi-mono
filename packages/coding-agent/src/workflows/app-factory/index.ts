import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const APP_FACTORY_VERSION = 1;
export const DEFAULT_STACK_PROFILE_ID = "nextjs-cloudflare-hono-betterauth-stripe";

export type AppFactoryStage =
	| "initialized"
	| "intake-complete"
	| "spec-drafted"
	| "approved"
	| "implementing"
	| "verified"
	| "retro-complete"
	| "archived";

export type AppFactoryTaskStatus = "pending" | "in_progress" | "done" | "blocked";

export interface AppFactoryIntake {
	appName: string;
	concept: string;
	purpose: string;
	stackNotes: string;
	uiuxReferences: string;
	referenceNotes: string;
}

export interface AppFactoryTask {
	id: string;
	title: string;
	description: string;
	status: AppFactoryTaskStatus;
	verificationNotes: string[];
}

export interface AppFactoryPaths {
	rootDir: string;
	openspecDir: string;
	changesDir: string;
	changeDir: string;
	specsDir: string;
	referencesDir: string;
	archiveDir: string;
	workflowStatePath: string;
	proposalPath: string;
	designPath: string;
	tasksPath: string;
	acceptancePath: string;
	retroPath: string;
	specPath: string;
	intakePath: string;
}

export interface AppFactoryWorkflowState {
	version: number;
	changeId: string;
	stackProfileId: string;
	stage: AppFactoryStage;
	createdAt: string;
	updatedAt: string;
	approvedAt?: string;
	archivedAt?: string;
	currentTaskId?: string;
	intake?: AppFactoryIntake;
	tasks: AppFactoryTask[];
	paths: AppFactoryPaths;
}

const DEFAULT_TASKS: Array<Pick<AppFactoryTask, "id" | "title" | "description">> = [
	{
		id: "1.1",
		title: "Scaffold platform shell",
		description: "Bootstrap the reusable frontend/backend foundation and shared environment contracts.",
	},
	{
		id: "1.2",
		title: "Build frontend shell",
		description: "Create the Next.js app shell, Tailwind tokens, layout primitives, and route skeletons.",
	},
	{
		id: "1.3",
		title: "Build API shell",
		description: "Create the Cloudflare Worker and Hono API boundary with typed contracts and health routes.",
	},
	{
		id: "1.4",
		title: "Wire auth boundary",
		description: "Integrate BetterAuth session boundaries and secure auth-related app plumbing.",
	},
	{
		id: "1.5",
		title: "Wire billing boundary",
		description: "Integrate Stripe billing entry points, configuration, and safe test-mode wiring.",
	},
	{
		id: "2.1",
		title: "Implement core product flow",
		description: "Build the primary user journey that expresses the approved concept and purpose.",
	},
	{
		id: "2.2",
		title: "Align UI and states",
		description: "Refine UI states, empty/error/loading flows, and styling against the approved references.",
	},
	{
		id: "2.3",
		title: "Lock verification coverage",
		description: "Add task-level tests and hold-out acceptance coverage for the critical product path.",
	},
	{
		id: "2.4",
		title: "Document handoff and reuse",
		description: "Document setup, environment expectations, and reusable stack decisions for the next project.",
	},
];

function nowIso(): string {
	return new Date().toISOString();
}

function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

function writeText(filePath: string, content: string): void {
	ensureDir(dirname(filePath));
	writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function taskStatusCheckbox(status: AppFactoryTaskStatus): string {
	return status === "done" ? "x" : " ";
}

export function slugifyChangeId(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

export function getAppFactoryPaths(rootDir: string, rawChangeId: string): AppFactoryPaths {
	const changeId = slugifyChangeId(rawChangeId);
	const projectRoot = resolve(rootDir);
	const openspecDir = join(projectRoot, "openspec");
	const changesDir = join(openspecDir, "changes");
	const changeDir = join(changesDir, changeId);
	const specsDir = join(changeDir, "specs", "product");
	const referencesDir = join(changeDir, "references");
	const archiveDir = join(changesDir, "archive");
	return {
		rootDir: projectRoot,
		openspecDir,
		changesDir,
		changeDir,
		specsDir,
		referencesDir,
		archiveDir,
		workflowStatePath: join(changeDir, "workflow.json"),
		proposalPath: join(changeDir, "proposal.md"),
		designPath: join(changeDir, "design.md"),
		tasksPath: join(changeDir, "tasks.md"),
		acceptancePath: join(changeDir, "acceptance.md"),
		retroPath: join(changeDir, "retro.md"),
		specPath: join(specsDir, "spec.md"),
		intakePath: join(referencesDir, "intake.md"),
	};
}

export function createAppFactoryChange(
	rootDir: string,
	rawChangeId: string,
	options?: { appName?: string; stackProfileId?: string },
): AppFactoryWorkflowState {
	const changeId = slugifyChangeId(rawChangeId);
	if (!changeId) {
		throw new Error("Change id cannot be empty.");
	}
	const paths = getAppFactoryPaths(rootDir, changeId);
	if (existsSync(paths.workflowStatePath)) {
		throw new Error(`Change '${changeId}' already exists at ${paths.changeDir}`);
	}

	ensureDir(paths.referencesDir);
	ensureDir(paths.specsDir);
	ensureDir(paths.archiveDir);

	const timestamp = nowIso();
	const state: AppFactoryWorkflowState = {
		version: APP_FACTORY_VERSION,
		changeId,
		stackProfileId: options?.stackProfileId ?? DEFAULT_STACK_PROFILE_ID,
		stage: "initialized",
		createdAt: timestamp,
		updatedAt: timestamp,
		tasks: [],
		paths,
		intake: options?.appName
			? {
					appName: options.appName,
					concept: "",
					purpose: "",
					stackNotes: "",
					uiuxReferences: "",
					referenceNotes: "",
				}
			: undefined,
	};
	saveAppFactoryState(state);
	return state;
}

export function loadAppFactoryState(rootDir: string, rawChangeId: string): AppFactoryWorkflowState {
	const paths = getAppFactoryPaths(rootDir, rawChangeId);
	if (!existsSync(paths.workflowStatePath)) {
		throw new Error(`No workflow found for '${slugifyChangeId(rawChangeId)}'`);
	}
	const state = readJson<AppFactoryWorkflowState>(paths.workflowStatePath);
	return { ...state, paths };
}

export function saveAppFactoryState(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	const nextState: AppFactoryWorkflowState = {
		...state,
		version: APP_FACTORY_VERSION,
		updatedAt: nowIso(),
	};
	writeText(nextState.paths.workflowStatePath, JSON.stringify(nextState, null, 2));
	return nextState;
}

export function updateAppFactoryIntake(
	state: AppFactoryWorkflowState,
	intake: AppFactoryIntake,
): AppFactoryWorkflowState {
	const nextState = saveAppFactoryState({
		...state,
		stage: "intake-complete",
		intake,
	});
	writeText(nextState.paths.intakePath, renderIntakeMarkdown(nextState));
	return nextState;
}

export function generateAppFactoryArtifacts(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	if (!state.intake) {
		throw new Error("Cannot generate spec artifacts before intake is complete.");
	}
	const tasks = state.tasks.length > 0 ? state.tasks : buildDefaultTasks();
	const nextState = saveAppFactoryState({
		...state,
		stage: "spec-drafted",
		tasks,
	});

	writeText(nextState.paths.intakePath, renderIntakeMarkdown(nextState));
	writeText(nextState.paths.proposalPath, renderProposalMarkdown(nextState));
	writeText(nextState.paths.designPath, renderDesignMarkdown(nextState));
	writeText(nextState.paths.specPath, renderSpecMarkdown(nextState));
	writeText(nextState.paths.tasksPath, renderTasksMarkdown(nextState));
	writeText(nextState.paths.acceptancePath, renderAcceptanceMarkdown(nextState));
	writeText(nextState.paths.retroPath, renderRetroMarkdown(nextState));
	return nextState;
}

export function syncAppFactoryArtifacts(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	if (state.intake) {
		writeText(state.paths.intakePath, renderIntakeMarkdown(state));
		writeText(state.paths.proposalPath, renderProposalMarkdown(state));
		writeText(state.paths.designPath, renderDesignMarkdown(state));
		writeText(state.paths.specPath, renderSpecMarkdown(state));
		writeText(state.paths.acceptancePath, renderAcceptanceMarkdown(state));
	}
	if (state.tasks.length > 0) {
		writeText(state.paths.tasksPath, renderTasksMarkdown(state));
	}
	writeText(state.paths.retroPath, renderRetroMarkdown(state));
	return state;
}

export function approveAppFactorySpec(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	if (state.stage !== "spec-drafted" && state.stage !== "approved" && state.stage !== "implementing") {
		throw new Error("Generate the OpenSpec artifacts before approval.");
	}
	return saveAppFactoryState({
		...state,
		stage: state.stage === "implementing" ? "implementing" : "approved",
		approvedAt: state.approvedAt ?? nowIso(),
	});
}

export function getNextPendingTask(state: AppFactoryWorkflowState): AppFactoryTask | undefined {
	return state.tasks.find((task) => task.status === "pending" || task.status === "blocked");
}

export function startNextAppFactoryTask(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	const nextTask = getNextPendingTask(state);
	if (!nextTask) {
		return saveAppFactoryState({ ...state, currentTaskId: undefined, stage: "verified" });
	}
	const tasks = state.tasks.map((task) => ({
		...task,
		status: task.id === nextTask.id ? "in_progress" : task.status,
	}));
	return saveAppFactoryState({
		...state,
		stage: "implementing",
		currentTaskId: nextTask.id,
		tasks,
	});
}

export function completeAppFactoryTask(
	state: AppFactoryWorkflowState,
	taskId: string,
	note?: string,
): AppFactoryWorkflowState {
	let completedCount = 0;
	const tasks = state.tasks.map((task) => {
		if (task.id !== taskId) return task;
		completedCount++;
		return {
			...task,
			status: "done" as const,
			verificationNotes: note ? [...task.verificationNotes, note] : task.verificationNotes,
		};
	});
	if (completedCount === 0) {
		throw new Error(`Task '${taskId}' was not found in workflow state.`);
	}
	const allDone = tasks.every((task) => task.status === "done");
	return saveAppFactoryState({
		...state,
		stage: allDone ? "verified" : "approved",
		currentTaskId: allDone ? undefined : state.currentTaskId === taskId ? undefined : state.currentTaskId,
		tasks,
	});
}

export function blockAppFactoryTask(
	state: AppFactoryWorkflowState,
	taskId: string,
	note?: string,
): AppFactoryWorkflowState {
	let blockedCount = 0;
	const tasks = state.tasks.map((task) => {
		if (task.id !== taskId) return task;
		blockedCount++;
		return {
			...task,
			status: "blocked" as const,
			verificationNotes: note ? [...task.verificationNotes, note] : task.verificationNotes,
		};
	});
	if (blockedCount === 0) {
		throw new Error(`Task '${taskId}' was not found in workflow state.`);
	}
	return saveAppFactoryState({
		...state,
		stage: "implementing",
		currentTaskId: undefined,
		tasks,
	});
}

export function markRetroComplete(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	return saveAppFactoryState({ ...state, stage: "retro-complete" });
}

export function archiveAppFactoryChange(state: AppFactoryWorkflowState): AppFactoryWorkflowState {
	const archiveName = `${new Date().toISOString().slice(0, 10)}-${state.changeId}`;
	const archivedChangeDir = join(state.paths.archiveDir, archiveName);
	if (existsSync(archivedChangeDir)) {
		throw new Error(`Archive destination already exists: ${archivedChangeDir}`);
	}
	renameSync(state.paths.changeDir, archivedChangeDir);
	const archivedPaths = getAppFactoryPaths(state.paths.rootDir, join("archive", archiveName));
	const archivedState = saveAppFactoryState({
		...state,
		stage: "archived",
		archivedAt: nowIso(),
		paths: {
			...archivedPaths,
			changeDir: archivedChangeDir,
			specsDir: join(archivedChangeDir, "specs", "product"),
			referencesDir: join(archivedChangeDir, "references"),
			workflowStatePath: join(archivedChangeDir, "workflow.json"),
			proposalPath: join(archivedChangeDir, "proposal.md"),
			designPath: join(archivedChangeDir, "design.md"),
			tasksPath: join(archivedChangeDir, "tasks.md"),
			acceptancePath: join(archivedChangeDir, "acceptance.md"),
			retroPath: join(archivedChangeDir, "retro.md"),
			specPath: join(archivedChangeDir, "specs", "product", "spec.md"),
			intakePath: join(archivedChangeDir, "references", "intake.md"),
		},
	});
	return archivedState;
}

export function renderExecutionPrompt(state: AppFactoryWorkflowState, task: AppFactoryTask): string {
	if (!state.intake) {
		throw new Error("Workflow intake is missing.");
	}
	return `Implement the next approved app-factory task.

Change: ${state.changeId}
Task: ${task.id} - ${task.title}

Task description:
${task.description}

Use these repo artifacts as the external source of truth:
- ${state.paths.proposalPath}
- ${state.paths.designPath}
- ${state.paths.specPath}
- ${state.paths.tasksPath}
- ${state.paths.acceptancePath}

Rules:
- Stay within the current task boundary
- Prefer TDD/SDD execution
- Update code and tests needed for this task
- Run relevant verification for this task
- If the task is complete, include exactly this marker in your response: [APP_TASK_DONE:${task.id}]
- If the task is blocked, include exactly this marker in your response: [APP_TASK_BLOCKED:${task.id}]
- Briefly summarize what changed and what was verified`;
}

export function renderVerifyPrompt(state: AppFactoryWorkflowState): string {
	return `Verify the current app-factory change against its approved artifacts.

Change: ${state.changeId}
Artifacts:
- ${state.paths.proposalPath}
- ${state.paths.designPath}
- ${state.paths.specPath}
- ${state.paths.tasksPath}
- ${state.paths.acceptancePath}

Check:
- completeness against tasks
- correctness against spec scenarios
- coherence against design
- notable risks or missing tests

Return a concise verification summary with concrete findings first.`;
}

export function renderRetroPrompt(state: AppFactoryWorkflowState): string {
	return `Write a retrospective for the completed app-factory change '${state.changeId}'.

Use this framing:
- what went right
- what went wrong
- what should change before the next project

Reference:
- ${state.paths.tasksPath}
- ${state.paths.acceptancePath}
- ${state.paths.retroPath}`;
}

export function summarizeAppFactoryState(state: AppFactoryWorkflowState): string {
	const lines = [
		`Change: ${state.changeId}`,
		`Stage: ${state.stage}`,
		`Stack profile: ${state.stackProfileId}`,
		`Task progress: ${state.tasks.filter((task) => task.status === "done").length}/${state.tasks.length}`,
	];
	if (state.currentTaskId) {
		lines.push(`Current task: ${state.currentTaskId}`);
	}
	if (state.intake?.appName) {
		lines.push(`App: ${state.intake.appName}`);
	}
	return lines.join("\n");
}

function buildDefaultTasks(): AppFactoryTask[] {
	return DEFAULT_TASKS.map((task) => ({
		...task,
		status: "pending",
		verificationNotes: [],
	}));
}

function renderIntakeMarkdown(state: AppFactoryWorkflowState): string {
	const intake = state.intake;
	if (!intake) {
		return "# Intake\n\nNo intake captured yet.\n";
	}
	return `# Intake

## App Name

${intake.appName}

## Concept

${intake.concept}

## Purpose

${intake.purpose}

## Stack Notes

${intake.stackNotes}

## UI/UX References

${intake.uiuxReferences || "None provided yet."}

## Reference Notes

${intake.referenceNotes || "None provided yet."}
`;
}

function renderProposalMarkdown(state: AppFactoryWorkflowState): string {
	const intake = requireIntake(state);
	return `# Proposal

## Why

Build a reusable fullstack product change around **${intake.appName}** so the team can move from idea to approved implementation with repo-owned workflow state instead of chat-only planning.

## What Changes

- define the product direction for ${intake.appName}
- implement the approved Next.js + Cloudflare Worker + Hono + BetterAuth + Stripe stack profile
- preserve reusable frontend/backend foundations for future projects

## Scope Notes

- this change follows an OpenSpec-style artifact flow
- implementation should pause for approval before work starts
- each task should be delivered in a bounded TDD/SDD loop
`;
}

function renderDesignMarkdown(state: AppFactoryWorkflowState): string {
	const intake = requireIntake(state);
	return `# Design

## Overview

${intake.appName} will use the default reusable fullstack profile:

- frontend: Next.js + Tailwind
- backend: Cloudflare Workers + Hono
- auth: BetterAuth
- billing: Stripe

## Product Intent

${intake.purpose}

## Architecture Notes

- keep reusable platform boundaries separate from product-specific logic
- centralize environment contracts early
- isolate auth and billing boundaries so they can be reused across future projects
- align visual language to the provided UI/UX references without hard-coding app-specific design into the base stack

## References

${intake.uiuxReferences || "No reference links captured yet."}

## Delivery Rules

- spec artifacts are the source of truth
- work one task at a time
- verify each task before moving on
- update acceptance and retro artifacts before archive
`;
}

function renderSpecMarkdown(state: AppFactoryWorkflowState): string {
	const intake = requireIntake(state);
	return `# Spec

## Requirement: Product foundation

The system must provide a reusable fullstack foundation for ${intake.appName} using the approved stack profile.

### Scenario: Platform bootstraps cleanly

- Given a fresh checkout
- When the project dependencies and local environment are configured
- Then the frontend and backend shells can start successfully

## Requirement: Primary user journey

The system must implement the primary user journey described by the approved concept and purpose.

### Scenario: User reaches the core flow

- Given a target user for ${intake.appName}
- When they enter the product and follow the primary path
- Then they can complete the intended core action without dead ends

## Requirement: Auth and billing boundaries

The system must support secure authentication and test-mode billing boundaries that match the approved stack.

### Scenario: Protected areas stay protected

- Given a signed-out user
- When they attempt to enter a protected flow
- Then authentication rules are enforced consistently

## Requirement: Acceptance coverage

The system must leave behind acceptance artifacts and verification evidence for future reuse.

### Scenario: Change is reviewable

- Given the implementation is complete
- When a reviewer inspects the change artifacts
- Then proposal, design, tasks, acceptance, and retro all align with the shipped code
`;
}

function renderTasksMarkdown(state: AppFactoryWorkflowState): string {
	const lines = [
		"# Tasks",
		"",
		"Use these tasks as the implementation loop source of truth.",
		"",
		"## Implementation Checklist",
		"",
	];
	for (const task of state.tasks) {
		lines.push(`- [${taskStatusCheckbox(task.status)}] ${task.id} ${task.title}`);
		lines.push(`  - ${task.description}`);
		if (task.verificationNotes.length > 0) {
			for (const note of task.verificationNotes) {
				lines.push(`  - note: ${note}`);
			}
		}
	}
	lines.push("");
	lines.push("## Execution Marker Contract");
	lines.push("");
	lines.push("- completed task response marker: `[APP_TASK_DONE:<task-id>]`");
	lines.push("- blocked task response marker: `[APP_TASK_BLOCKED:<task-id>]`");
	return lines.join("\n");
}

function renderAcceptanceMarkdown(state: AppFactoryWorkflowState): string {
	const intake = requireIntake(state);
	return `# Acceptance

## Usage Guide Checks

- a reviewer can identify the app purpose for ${intake.appName} from the shipped UX
- the primary user journey can be demonstrated end-to-end
- auth-sensitive routes behave correctly
- Stripe wiring stays in safe test mode unless explicitly changed

## Hold-Out Checks

- verify loading, empty, and error states for the main flow
- verify authenticated and unauthenticated entry paths
- verify platform setup can be repeated by another developer

## Review Notes

Add real acceptance evidence here during verification.
`;
}

function renderRetroMarkdown(_state: AppFactoryWorkflowState): string {
	return `# Retro

## What Went Right

- pending

## What Went Wrong

- pending

## What To Change Next Time

- pending
`;
}

function requireIntake(state: AppFactoryWorkflowState): AppFactoryIntake {
	if (!state.intake) {
		throw new Error("Workflow intake has not been captured yet.");
	}
	return state.intake;
}
