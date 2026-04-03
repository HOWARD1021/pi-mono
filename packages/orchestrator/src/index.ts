import { execSync } from "node:child_process";
import { AgentRunner } from "./agent-runner.js";
import { CIRunner } from "./ci-runner.js";
import { loadContext } from "./context-loader.js";
import { FailureExtractor } from "./failure-extractor.js";
import { Notifier } from "./notifier.js";
import { buildPrompt } from "./prompt-builder.js";
import { ReviewOrchestrator } from "./review-orchestrator.js";
import { parseSpec } from "./spec-parser.js";
import { TaskRegistry } from "./task-registry.js";
import { TaskScheduler } from "./task-scheduler.js";
import type { ParsedTask, TaskRunResult } from "./types.js";
import { WorktreeManager } from "./worktree-manager.js";

export { parseSpec };

const REGISTRY_PATH = ".clawdbot/active-tasks.json";

export async function orchestrate(specPath: string): Promise<void> {
	const spec = parseSpec(specPath);
	console.log(`\n[Orchestrator] Feature: ${spec.feature}`);
	console.log(`[Orchestrator] Tasks: ${spec.tasks.map((t) => t.id).join(", ")}`);

	const registry = new TaskRegistry(REGISTRY_PATH);
	const scheduler = new TaskScheduler(3);
	const notifier = new Notifier();

	const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();

	await scheduler.run(spec.tasks, async (task) => {
		const result = await runTaskWithRetry(task, spec.contextFiles, currentBranch, registry);
		if (result.success) {
			await notifier.notifyReady(task.id, result.prNumber!, result.prUrl!);
		} else {
			await notifier.notifyFailed(task.id, task.maxRetries, result.failureReason ?? "unknown");
		}
	});
}

export async function runTaskWithRetry(
	task: ParsedTask,
	contextFiles: string[],
	baseBranch: string,
	registry?: TaskRegistry,
): Promise<TaskRunResult> {
	const repoRoot = execSync("git rev-parse --show-toplevel", { stdio: "pipe" }).toString().trim();
	const worktreeManager = new WorktreeManager(repoRoot);
	const ciRunner = new CIRunner();
	const failureExtractor = new FailureExtractor();
	const reviewOrchestrator = new ReviewOrchestrator();
	const reg = registry ?? new TaskRegistry(REGISTRY_PATH);
	const contextChunks = loadContext(contextFiles);

	const branch = `agent/${task.id}-${Date.now()}`;
	const wt = worktreeManager.create(task.id, branch, baseBranch);

	await reg.set(task.id, {
		id: task.id,
		branch,
		worktree: wt.path,
		baseCommitSha: wt.baseCommitSha,
		status: "running",
		attempts: 0,
		maxRetries: task.maxRetries,
		attemptHistory: [],
		startedAt: Date.now(),
		model: task.model,
	});

	const attemptHistory: string[] = [];

	for (let attempt = 1; attempt <= task.maxRetries; attempt++) {
		console.log(`\n[${task.id}] Attempt ${attempt}/${task.maxRetries}`);
		await reg.update(task.id, { attempts: attempt });

		try {
			let gitLog = "";
			try {
				gitLog = execSync(`git log --oneline -10`, { cwd: wt.path, stdio: "pipe" }).toString();
			} catch {
				/* empty branch */
			}

			const prompt = buildPrompt(task, contextChunks, attemptHistory, gitLog);

			console.log(`[${task.id}] Spawning claude agent...`);
			const agentRunner = new AgentRunner(wt.path);
			const agentResult = await agentRunner.run(prompt, task.model, undefined, wt.baseCommitSha);
			console.log(`[${task.id}] Agent done — commit: ${agentResult.lastCommitSha}`);

			const prNumber = await createOrUpdatePR(wt.path, branch, task.title, attempt);

			console.log(`[${task.id}] Running local CI...`);
			const localCI = ciRunner.runLocal(wt.path);
			if (!localCI.passed) {
				const failure = await failureExtractor.extract(localCI.errorOutput, wt.path);
				attemptHistory.push(
					`Attempt ${attempt} (local CI failed):\nApproach tried: ${failure.approach}\nRoot cause: ${failure.summary}\nFailed tests: ${failure.failedTests.join(", ")}`,
				);
				await reg.update(task.id, { attemptHistory });
				worktreeManager.reset(wt.path, wt.baseCommitSha);
				continue;
			}

			console.log(`[${task.id}] Running cloud CI on PR #${prNumber}...`);
			const cloudCI = await ciRunner.runCloud(branch);
			if (!cloudCI.passed) {
				const ciLogs = await fetchCILogs(prNumber);
				const failure = await failureExtractor.extract(ciLogs || cloudCI.errorOutput, wt.path);
				attemptHistory.push(
					`Attempt ${attempt} (cloud CI failed):\nApproach tried: ${failure.approach}\nRoot cause: ${failure.summary}\nFailed checks: ${cloudCI.failedChecks.join(", ")}`,
				);
				await reg.update(task.id, { attemptHistory });
				worktreeManager.reset(wt.path, wt.baseCommitSha);
				continue;
			}

			const review = await reviewOrchestrator.review(prNumber);
			if (!review.passed) {
				attemptHistory.push(
					`Attempt ${attempt} (review failed):\nCritical issues:\n${review.criticalIssues.join("\n")}`,
				);
				await reg.update(task.id, { attemptHistory });
				worktreeManager.reset(wt.path, wt.baseCommitSha);
				continue;
			}

			const prUrl = getPRUrl(prNumber);
			await reg.update(task.id, {
				status: "done",
				pr: prNumber,
				prUrl,
				completedAt: Date.now(),
			});

			console.log(`[${task.id}] Done — PR #${prNumber}`);
			return { success: true, prNumber, prUrl, attemptHistory };
		} catch (e) {
			const msg = (e as Error).message;
			attemptHistory.push(`Attempt ${attempt} (error): ${msg}`);
			await reg.update(task.id, { attemptHistory });
			if (attempt < task.maxRetries) {
				worktreeManager.reset(wt.path, wt.baseCommitSha);
			}
		}
	}

	await reg.update(task.id, { status: "failed", completedAt: Date.now() });
	worktreeManager.remove(wt.path);

	return {
		success: false,
		failureReason: `All ${task.maxRetries} attempts failed`,
		attemptHistory,
	};
}

async function createOrUpdatePR(worktreePath: string, branch: string, title: string, attempt: number): Promise<number> {
	const opts = { cwd: worktreePath, stdio: "pipe" as const, timeout: 30_000 };

	if (attempt === 1) {
		console.log(`[PR] Pushing branch ${branch}...`);
		execSync(`git push -u origin ${branch}`, opts);
		console.log(`[PR] Creating PR...`);
		const out = execSync(`gh pr create --title "${title}" --body "Automated by Pi Orchestrator" --fill`, opts);
		const match = out.toString().match(/\/pull\/(\d+)/);
		return parseInt(match?.[1] ?? "0", 10);
	} else {
		execSync(`git push --force-with-lease origin ${branch}`, opts);
		const out = execSync(`gh pr view --json number`, opts);
		return JSON.parse(out.toString()).number;
	}
}

function getPRUrl(prNumber: number): string {
	try {
		const out = execSync(`gh pr view ${prNumber} --json url`, { stdio: "pipe" });
		return JSON.parse(out.toString()).url;
	} catch {
		return `https://github.com/pull/${prNumber}`;
	}
}

async function fetchCILogs(_prNumber: number): Promise<string> {
	try {
		return execSync(`gh run list --json databaseId --limit 1 | gh run view --log-failed`, {
			stdio: "pipe",
		})
			.toString()
			.slice(0, 3_000);
	} catch {
		return "";
	}
}
