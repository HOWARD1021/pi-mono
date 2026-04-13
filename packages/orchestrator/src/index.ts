import { execSync } from "node:child_process";
import { AgentRunner } from "./agent-runner.js";
import { CIRunner } from "./ci-runner.js";
import { loadContext } from "./context-loader.js";
import { EvalLoop, type EvalLoopResult } from "./eval-loop.js";
import { CodeEvalRunner } from "./eval-runner.js";
import { FailureExtractor } from "./failure-extractor.js";
import { Notifier } from "./notifier.js";
import { buildPrompt } from "./prompt-builder.js";
import { ReviewOrchestrator } from "./review-orchestrator.js";
import { parseSpec } from "./spec-parser.js";
import { TaskRegistry } from "./task-registry.js";
import { TaskScheduler } from "./task-scheduler.js";
import type { ParsedSpec, ParsedTask, TaskRunResult } from "./types.js";
import { WorktreeManager } from "./worktree-manager.js";

export { parseSpec };

const REGISTRY_PATH = ".clawdbot/active-tasks.json";

/** Route a spec with `eval:` to EvalLoop instead of runTaskWithRetry. */
export async function runEvalSpec(spec: ParsedSpec, baseBranch: string): Promise<EvalLoopResult> {
	if (!spec.eval) throw new Error("runEvalSpec called on spec without eval block");

	const evalSpec = spec.eval;
	// Pick the right evaluator from the runner name
	const evaluator =
		evalSpec.runner === "code-coverage"
			? new CodeEvalRunner()
			: (() => {
					throw new Error(`Unknown runner: ${evalSpec.runner}`);
				})();

	// Run each task through EvalLoop (in series for now — first task wins)
	const task = spec.tasks[0];
	console.log(`\n[EvalSpec] Feature: ${spec.feature} | Task: ${task.id} | Target: ${evalSpec.target}`);

	const loop = new EvalLoop(evalSpec, evaluator);
	return loop.run(task, spec.contextFiles, baseBranch);
}

export async function orchestrate(specPath: string): Promise<void> {
	const spec = parseSpec(specPath);
	console.log(`\n[Orchestrator] Feature: ${spec.feature}`);
	console.log(`[Orchestrator] Tasks: ${spec.tasks.map((t) => t.id).join(", ")}`);

	// Route to EvalLoop when spec has eval: block
	if (spec.eval) {
		const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();
		const result = await runEvalSpec(spec, currentBranch);
		console.log(
			`\n[Orchestrator] EvalLoop done — best score: ${result.bestScore}, reached target: ${result.reachedTarget}`,
		);
		return;
	}

	const registry = new TaskRegistry(REGISTRY_PATH);
	const scheduler = new TaskScheduler(3);
	const notifier = new Notifier();

	const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();

	// Gap C: recover orphaned tasks that were "running" when the process last crashed
	const orphaned = await registry.getRunning();
	if (orphaned.length > 0) {
		console.log(`\n[Orchestrator] Recovering ${orphaned.length} orphaned task(s)...`);
		for (const record of orphaned) {
			const specTask = spec.tasks.find((t) => t.id === record.id);
			if (!specTask) {
				console.log(`[Orchestrator] Orphaned task "${record.id}" not in spec — marking failed`);
				await registry.update(record.id, { status: "failed", completedAt: Date.now() });
				continue;
			}
			console.log(
				`[Orchestrator] Re-entering "${record.id}" at attempt ${record.attempts + 1}/${record.maxRetries}`,
			);
			const result = await runTaskWithRetry(
				specTask,
				spec.contextFiles,
				currentBranch,
				registry,
				record.attemptHistory,
			);
			if (result.success) {
				await notifier.notifyReady(record.id, result.prNumber!, result.prUrl!);
			} else {
				await notifier.notifyFailed(record.id, record.maxRetries, result.failureReason ?? "unknown");
			}
		}
	}

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
	initialAttemptHistory?: string[],
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

	const attemptHistory: string[] = initialAttemptHistory ?? [];

	for (let attempt = 1; attempt <= task.maxRetries; attempt++) {
		console.log(`\n[${task.id}] Attempt ${attempt}/${task.maxRetries}`);
		await reg.update(task.id, { attempts: attempt });

		// Escalate to fallback model/runner on retry attempts
		const activeModel = attempt > 1 && task.fallbackModel ? task.fallbackModel : task.model;
		const activeRunner = attempt > 1 && task.fallbackRunner ? task.fallbackRunner : task.runner;

		try {
			let gitLog = "";
			try {
				gitLog = execSync(`git log --oneline -10`, { cwd: wt.path, stdio: "pipe" }).toString();
			} catch {
				/* empty branch */
			}

			const prompt = buildPrompt(task, contextChunks, attemptHistory, gitLog);

			console.log(`[${task.id}] Spawning ${activeRunner} agent (model: ${activeModel})...`);
			const agentRunner = new AgentRunner(wt.path, activeRunner);
			const agentResult = await agentRunner.run(prompt, activeModel, undefined, wt.baseCommitSha);
			console.log(`[${task.id}] Agent done — commit: ${agentResult.lastCommitSha}`);

			const prNumber = await createOrUpdatePR(wt.path, branch, task.title, attempt, baseBranch);

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

async function createOrUpdatePR(
	worktreePath: string,
	branch: string,
	title: string,
	attempt: number,
	baseBranch: string,
): Promise<number> {
	const opts = { cwd: worktreePath, stdio: "pipe" as const, timeout: 30_000 };

	if (attempt === 1) {
		console.log(`[PR] Pushing branch ${branch}...`);
		execSync(`git push -u origin ${branch}`, opts);
		console.log(`[PR] Creating PR...`);
		const out = execSync(
			`gh pr create --title "${title}" --body "Automated by Pi Orchestrator" --base "${baseBranch}" --fill`,
			opts,
		);
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
