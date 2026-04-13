import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScoreEntry, ScoreHistory } from "./types.js";

type Store = Record<string, ScoreHistory>;

export class ScoreRegistry {
	constructor(private readonly filePath: string) {
		mkdirSync(dirname(this.filePath), { recursive: true });
	}

	private load(): Store {
		if (!existsSync(this.filePath)) return {};
		try {
			return JSON.parse(readFileSync(this.filePath, "utf8")) as Store;
		} catch {
			return {};
		}
	}

	private save(store: Store): void {
		const tmp = `${this.filePath}.tmp`;
		writeFileSync(tmp, JSON.stringify(store, null, 2));
		renameSync(tmp, this.filePath); // atomic
	}

	async get(taskId: string): Promise<ScoreHistory | undefined> {
		return this.load()[taskId];
	}

	async record(taskId: string, entry: ScoreEntry): Promise<void> {
		const store = this.load();
		const existing = store[taskId];

		if (!existing) {
			store[taskId] = {
				taskId,
				bestScore: entry.score,
				bestCommitSha: entry.commitSha,
				entries: [entry],
			};
		} else {
			existing.entries.push(entry);
			if (entry.score > existing.bestScore) {
				existing.bestScore = entry.score;
				existing.bestCommitSha = entry.commitSha;
			}
		}

		this.save(store);
	}
}
