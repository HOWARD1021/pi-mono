export interface ParsedTask {
  id: string;
  title: string;
  model: string; // default: "claude-opus-4-6"
  maxRetries: number; // default: 3
  requiresScreenshots: boolean; // default: false
  dependsOn: string[]; // task IDs that must complete first
  description: string; // free-form markdown body
}

export interface ParsedSpec {
  feature: string;
  contextFiles: string[]; // absolute paths, pre-validated
  tasks: ParsedTask[];
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
