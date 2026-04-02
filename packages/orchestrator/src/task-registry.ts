import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TaskRecord } from "./types.js";

type Registry = Record<string, TaskRecord>;

export class TaskRegistry {
	constructor(private readonly filePath: string) {
		mkdirSync(dirname(this.filePath), { recursive: true });
	}

	private load(): Registry {
		if (!existsSync(this.filePath)) return {};
		try {
			return JSON.parse(readFileSync(this.filePath, "utf8")) as Registry;
		} catch {
			return {};
		}
	}

	private save(registry: Registry): void {
		const tmp = `${this.filePath}.tmp`;
		writeFileSync(tmp, JSON.stringify(registry, null, 2));
		renameSync(tmp, this.filePath); // atomic
	}

	async get(id: string): Promise<TaskRecord | undefined> {
		return this.load()[id];
	}

	async set(id: string, record: TaskRecord): Promise<void> {
		const registry = this.load();
		registry[id] = record;
		this.save(registry);
	}

	async update(id: string, patch: Partial<TaskRecord>): Promise<void> {
		const registry = this.load();
		if (!registry[id]) throw new Error(`Task "${id}" not found in registry`);
		registry[id] = { ...registry[id], ...patch };
		this.save(registry);
	}

	async getRunning(): Promise<TaskRecord[]> {
		return Object.values(this.load()).filter((r) => r.status === "running");
	}

	async getAll(): Promise<TaskRecord[]> {
		return Object.values(this.load());
	}
}
