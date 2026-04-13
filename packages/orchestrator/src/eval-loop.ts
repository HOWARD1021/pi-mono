import { execSync } from "node:child_process";
import { AgentRunner } from "./agent-runner.js";
import type { EvalRunner } from "./eval-runner.js";
import { buildPrompt } from "./prompt-builder.js";
import { ScoreRegistry } from "./score-registry.js";
import type { EvalSpec, ParsedTask, ScoreEntry, ScoreHistory } from "./types.js";
import { WorktreeManager } from "./worktree-manager.js";

const REGISTRY_PATH = ".clawdbot/scores.json";

export interface EvalLoopResult {
	reachedTarget: boolean;
	bestScore: number;
	bestCommitSha: string;
	generations: number;
	history: ScoreEntry[];
}

export class EvalLoop {
	private readonly scoreRegistry: ScoreRegistry;

	constructor(
		private readonly spec: EvalSpec,
		private readonly evaluator: EvalRunner,
		registryPath = REGISTRY_PATH,
	) {
		this.scoreRegistry = new ScoreRegistry(registryPath);
	}

	async run(task: ParsedTask, _contextFiles: string[], baseBranch: string): Promise<EvalLoopResult> {
		const repoRoot = execSync("git rev-parse --show-toplevel", { stdio: "pipe" }).toString().trim();
		const worktreeManager = new WorktreeManager(repoRoot);

		const branch = `agent/${task.id}-eval-${Date.now()}`;
		console.log(`[EvalLoop:${task.id}] Creating worktree on branch: ${branch}`);
		const wt = worktreeManager.create(task.id, branch, baseBranch);
		console.log(`[EvalLoop:${task.id}] Worktree ready at: ${wt.path} (base SHA: ${wt.baseCommitSha})`);

		const maxGenerations = this.spec.maxGenerations ?? 20;
		console.log(`[EvalLoop:${task.id}] Target: ${this.spec.target} | Max gens: ${maxGenerations}`);
		const historyEntries: ScoreEntry[] = [];
		let bestScore = -Infinity;
		let bestCommitSha = wt.baseCommitSha;
		let reachedTarget = false;

		for (let gen = 1; gen <= maxGenerations; gen++) {
			// Build score history for prompt context
			const scoreHistory: ScoreHistory | undefined =
				historyEntries.length > 0
					? {
							taskId: task.id,
							bestScore,
							bestCommitSha,
							entries: historyEntries,
						}
					: undefined;

			const prompt = buildPrompt(task, "", [], "", scoreHistory);

			console.log(
				`\n[EvalLoop:${task.id}] Generation ${gen}/${maxGenerations} (best so far: ${bestScore === -Infinity ? "none" : bestScore})`,
			);
			console.log(`[EvalLoop:${task.id}] Worktree: ${wt.path} | Branch: ${branch}`);
			const agentRunner = new AgentRunner(wt.path, task.runner);
			const agentResult = await agentRunner.run(prompt, task.model, undefined, wt.baseCommitSha);
			console.log(`[EvalLoop:${task.id}] Agent done — commit: ${agentResult.lastCommitSha}`);
			try {
				const diffStat = execSync(`git diff --stat ${wt.baseCommitSha}..HEAD`, { cwd: wt.path, stdio: "pipe" })
					.toString()
					.trim();
				if (diffStat) console.log(`[EvalLoop:${task.id}] Changes:\n${diffStat}`);
			} catch {
				/* ignore */
			}

			// Evaluate the result
			console.log(`[EvalLoop:${task.id}] Running evaluator...`);
			const evalResult = this.evaluator.run(wt.path);
			console.log(`[EvalLoop:${task.id}] Eval score: ${evalResult.score}`);
			if (evalResult.details) {
				console.log(`[EvalLoop:${task.id}] Details:\n${evalResult.details}`);
			}
			const isNewBest = evalResult.score > bestScore;
			const entry: ScoreEntry = {
				generation: gen,
				score: evalResult.score,
				commitSha: agentResult.lastCommitSha,
				kept: isNewBest,
			};

			historyEntries.push(entry);
			await this.scoreRegistry.record(task.id, entry);

			if (isNewBest) {
				bestScore = evalResult.score;
				bestCommitSha = agentResult.lastCommitSha;
				console.log(`[EvalLoop:${task.id}] gen ${gen}: ${evalResult.score} → new best ✓`);
			} else {
				// Discard — reset worktree to last best
				worktreeManager.reset(wt.path, wt.baseCommitSha);
				console.log(`[EvalLoop:${task.id}] gen ${gen}: ${evalResult.score} → dropped (best=${bestScore})`);
			}

			if (evalResult.score >= this.spec.target) {
				reachedTarget = true;
				console.log(`[EvalLoop:${task.id}] Target ${this.spec.target} reached at gen ${gen}!`);
				break;
			}
		}

		return {
			reachedTarget,
			bestScore: bestScore === -Infinity ? 0 : bestScore,
			bestCommitSha,
			generations: historyEntries.length,
			history: historyEntries,
		};
	}
}
