import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	archiveAppFactoryChange,
	completeAppFactoryTask,
	createAppFactoryChange,
	generateAppFactoryArtifacts,
	loadAppFactoryState,
	slugifyChangeId,
	startNextAppFactoryTask,
	syncAppFactoryArtifacts,
	updateAppFactoryIntake,
} from "../src/workflows/app-factory/index.js";

describe("app-factory workflow", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-app-factory-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("slugifies change ids", () => {
		expect(slugifyChangeId(" My New App! ")).toBe("my-new-app");
	});

	it("creates a new change with workflow state", () => {
		const state = createAppFactoryChange(tempDir, "My New App", { appName: "My New App" });
		expect(state.changeId).toBe("my-new-app");
		expect(fs.existsSync(state.paths.workflowStatePath)).toBe(true);
		expect(fs.existsSync(state.paths.referencesDir)).toBe(true);
	});

	it("captures intake and generates OpenSpec artifacts", () => {
		const initial = createAppFactoryChange(tempDir, "my-new-app", { appName: "My New App" });
		const withIntake = updateAppFactoryIntake(initial, {
			appName: "My New App",
			concept: "Build a modern membership app.",
			purpose: "Turn a concept and references into a reusable shipped product.",
			stackNotes: "Use the default stack profile.",
			uiuxReferences: "https://example.com/ref-one\nhttps://example.com/ref-two",
			referenceNotes: "Clean editorial UI with strong dashboard hierarchy.",
		});
		const drafted = generateAppFactoryArtifacts(withIntake);

		expect(drafted.stage).toBe("spec-drafted");
		expect(drafted.tasks.length).toBeGreaterThan(0);
		expect(fs.readFileSync(drafted.paths.proposalPath, "utf8")).toContain("My New App");
		expect(fs.readFileSync(drafted.paths.tasksPath, "utf8")).toContain("1.1");
		expect(fs.readFileSync(drafted.paths.acceptancePath, "utf8")).toContain("Usage Guide Checks");
	});

	it("progresses task state and syncs task markdown", () => {
		const initial = createAppFactoryChange(tempDir, "my-new-app", { appName: "My New App" });
		const drafted = generateAppFactoryArtifacts(
			updateAppFactoryIntake(initial, {
				appName: "My New App",
				concept: "Build a modern membership app.",
				purpose: "Turn a concept and references into a reusable shipped product.",
				stackNotes: "Use the default stack profile.",
				uiuxReferences: "",
				referenceNotes: "",
			}),
		);
		const inProgress = startNextAppFactoryTask(drafted);
		expect(inProgress.currentTaskId).toBe("1.1");
		expect(inProgress.tasks[0]?.status).toBe("in_progress");

		const completed = syncAppFactoryArtifacts(
			completeAppFactoryTask(inProgress, "1.1", "Verified with initial scaffold checks."),
		);
		expect(completed.currentTaskId).toBeUndefined();
		expect(completed.tasks[0]?.status).toBe("done");
		expect(fs.readFileSync(completed.paths.tasksPath, "utf8")).toContain("[x] 1.1");
	});

	it("loads persisted workflow state from disk", () => {
		const state = createAppFactoryChange(tempDir, "another-app", { appName: "Another App" });
		const loaded = loadAppFactoryState(tempDir, state.changeId);
		expect(loaded.changeId).toBe(state.changeId);
		expect(loaded.paths.workflowStatePath).toBe(state.paths.workflowStatePath);
	});

	it("archives the change into the archive folder", () => {
		const initial = createAppFactoryChange(tempDir, "archive-me", { appName: "Archive Me" });
		const drafted = generateAppFactoryArtifacts(
			updateAppFactoryIntake(initial, {
				appName: "Archive Me",
				concept: "Build an archiveable app workflow.",
				purpose: "Confirm archive flow moves the change folder.",
				stackNotes: "Use the default stack profile.",
				uiuxReferences: "",
				referenceNotes: "",
			}),
		);
		const archived = archiveAppFactoryChange(drafted);
		expect(archived.stage).toBe("archived");
		expect(fs.existsSync(archived.paths.workflowStatePath)).toBe(true);
		expect(archived.paths.changeDir).toContain(path.join("openspec", "changes", "archive"));
	});
});
