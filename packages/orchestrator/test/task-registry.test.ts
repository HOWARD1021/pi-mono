import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskRegistry } from "../src/task-registry.js";
import type { TaskRecord } from "../src/types.js";

function makeRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: "task-1",
		branch: "agent/task-1",
		worktree: "/tmp/wt/task-1",
		baseCommitSha: "abc1234",
		status: "pending",
		attempts: 0,
		maxRetries: 3,
		attemptHistory: [],
		startedAt: Date.now(),
		model: "claude-opus-4-6",
		...overrides,
	};
}

describe("TaskRegistry", () => {
	let tempDir: string;
	let registry: TaskRegistry;

	beforeEach(() => {
		tempDir = join(tmpdir(), `registry-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		registry = new TaskRegistry(join(tempDir, "active-tasks.json"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates and retrieves a record", async () => {
		const rec = makeRecord();
		await registry.set("task-1", rec);
		const got = await registry.get("task-1");
		expect(got?.id).toBe("task-1");
	});

	it("updates a record", async () => {
		await registry.set("task-1", makeRecord());
		await registry.update("task-1", { status: "running", attempts: 1 });
		const got = await registry.get("task-1");
		expect(got?.status).toBe("running");
		expect(got?.attempts).toBe(1);
	});

	it("returns running tasks", async () => {
		await registry.set("task-1", makeRecord({ status: "running" }));
		await registry.set("task-2", makeRecord({ id: "task-2", status: "done" }));
		const running = await registry.getRunning();
		expect(running).toHaveLength(1);
		expect(running[0].id).toBe("task-1");
	});

	it("returns undefined for missing task", async () => {
		expect(await registry.get("nope")).toBeUndefined();
	});

	it("persists across instances", async () => {
		await registry.set("task-1", makeRecord({ status: "done" }));
		const registry2 = new TaskRegistry(join(tempDir, "active-tasks.json"));
		const got = await registry2.get("task-1");
		expect(got?.status).toBe("done");
	});
});
