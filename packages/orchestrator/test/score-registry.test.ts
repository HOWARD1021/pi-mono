import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScoreRegistry } from "../src/score-registry.js";

let tmpDir: string;
let registryPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "score-registry-test-"));
	registryPath = join(tmpDir, "scores.json");
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("ScoreRegistry", () => {
	it("returns undefined for a task with no history", async () => {
		const reg = new ScoreRegistry(registryPath);
		const history = await reg.get("task-1");
		expect(history).toBeUndefined();
	});

	it("records first entry as the best", async () => {
		const reg = new ScoreRegistry(registryPath);
		await reg.record("task-1", { generation: 1, score: 72, commitSha: "abc1", kept: true });

		const history = await reg.get("task-1");
		expect(history).toBeDefined();
		expect(history!.bestScore).toBe(72);
		expect(history!.bestCommitSha).toBe("abc1");
		expect(history!.entries).toHaveLength(1);
	});

	it("updates best when new entry beats current best", async () => {
		const reg = new ScoreRegistry(registryPath);
		await reg.record("task-1", { generation: 1, score: 72, commitSha: "abc1", kept: true });
		await reg.record("task-1", { generation: 2, score: 85, commitSha: "abc2", kept: true });

		const history = await reg.get("task-1");
		expect(history!.bestScore).toBe(85);
		expect(history!.bestCommitSha).toBe("abc2");
		expect(history!.entries).toHaveLength(2);
	});

	it("does not update best when new entry is lower", async () => {
		const reg = new ScoreRegistry(registryPath);
		await reg.record("task-1", { generation: 1, score: 85, commitSha: "abc1", kept: true });
		await reg.record("task-1", { generation: 2, score: 70, commitSha: "abc2", kept: false });

		const history = await reg.get("task-1");
		expect(history!.bestScore).toBe(85);
		expect(history!.bestCommitSha).toBe("abc1");
		expect(history!.entries).toHaveLength(2);
	});

	it("persists across instances (survives re-instantiation)", async () => {
		const reg1 = new ScoreRegistry(registryPath);
		await reg1.record("task-1", { generation: 1, score: 77, commitSha: "sha1", kept: true });

		const reg2 = new ScoreRegistry(registryPath);
		const history = await reg2.get("task-1");
		expect(history!.bestScore).toBe(77);
	});

	it("tracks multiple tasks independently", async () => {
		const reg = new ScoreRegistry(registryPath);
		await reg.record("task-1", { generation: 1, score: 80, commitSha: "a1", kept: true });
		await reg.record("task-2", { generation: 1, score: 60, commitSha: "b1", kept: true });

		expect((await reg.get("task-1"))!.bestScore).toBe(80);
		expect((await reg.get("task-2"))!.bestScore).toBe(60);
	});
});
