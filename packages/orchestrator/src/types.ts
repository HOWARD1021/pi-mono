export interface ParsedTask {
	id: string;
	title: string;
	model: string; // default: "claude-opus-4-6"
	runner: "claude" | "copilot"; // default: "claude"
	fallbackModel?: string; // used on attempt > 1; defaults to model
	fallbackRunner?: "claude" | "copilot"; // used on attempt > 1; defaults to runner
	maxRetries: number; // default: 3
	requiresScreenshots: boolean; // default: false
	dependsOn: string[]; // task IDs that must complete first
	description: string; // free-form markdown body
}

export interface ParsedSpec {
	feature: string;
	contextFiles: string[]; // absolute paths, pre-validated
	tasks: ParsedTask[];
	eval?: EvalSpec; // present = run EvalLoop instead of runTaskWithRetry
}

export interface DefinitionOfDone {
	prCreated: boolean;
	localCIPassed: boolean;
	cloudCIPassed: boolean;
	codexReviewPassed: boolean;
	copilotReviewPassed: boolean;
	geminiReviewPassed: boolean;
	claudeReviewPassed: boolean;
	screenshotsIncluded: boolean;
}

export type TaskStatus = "pending" | "running" | "done" | "failed" | "waiting_review";

export interface TaskRecord {
	id: string;
	branch: string;
	worktree: string;
	baseCommitSha: string; // captured at worktree creation for clean resets
	status: TaskStatus;
	attempts: number;
	maxRetries: number;
	attemptHistory: string[]; // failure context per attempt
	pr?: number;
	prUrl?: string;
	checks?: DefinitionOfDone;
	startedAt: number;
	completedAt?: number;
	model: string;
}

export interface CIResult {
	passed: boolean;
	failedChecks: string[];
	runId?: string;
	errorOutput: string;
}

export interface FailureContext {
	summary: string;
	failedTests: string[];
	approach: string;
}

export interface AgentResult {
	summary: string | null;
	lastCommitSha: string;
}

export interface ReviewResult {
	passed: boolean;
	criticalIssues: string[];
}

export interface TaskRunResult {
	success: boolean;
	prNumber?: number;
	prUrl?: string;
	failureReason?: string;
	attemptHistory: string[];
}

// ─── EvalLoop types ───────────────────────────────────────────────────────────

export interface EvalResult {
	score: number; // 0–100 (normalised)
	details: string; // human-readable breakdown
}

export interface ScoreEntry {
	generation: number;
	score: number;
	commitSha: string;
	kept: boolean; // true = new best, false = discarded
}

export interface ScoreHistory {
	taskId: string;
	bestScore: number;
	bestCommitSha: string;
	entries: ScoreEntry[];
}

export interface EvalSpec {
	type: "track-a" | "track-b" | "hybrid";
	runner: string; // "code-coverage" | "skill-judge" | ...
	target: number; // stop when score >= target
	timeBudgetMs?: number;
	maxGenerations?: number;
}
