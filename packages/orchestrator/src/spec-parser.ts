import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ParsedSpec, ParsedTask } from "./types.js";

const TaskFrontmatterSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	model: z.string().default("claude-opus-4-6"),
	"max-retries": z.number().int().min(1).default(3),
	"requires-screenshots": z.boolean().default(false),
	"depends-on": z.array(z.string()).default([]),
});

const SpecFrontmatterSchema = z.object({
	feature: z.string().min(1),
	context: z.array(z.string()).default([]),
	tasks: z.array(TaskFrontmatterSchema).min(1),
});

export class SpecValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SpecValidationError";
	}
}

export function parseSpec(filePath: string): ParsedSpec {
	const raw = readFileSync(filePath, "utf8");
	const specDir = dirname(resolve(filePath));

	// Split frontmatter from body
	const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!fmMatch) {
		throw new SpecValidationError("Spec file must start with YAML frontmatter (--- ... ---)");
	}

	const [, yamlStr, bodyStr] = fmMatch;

	// Parse + validate YAML
	let rawFm: unknown;
	try {
		rawFm = parseYaml(yamlStr);
	} catch (e) {
		throw new SpecValidationError(`Invalid YAML frontmatter: ${(e as Error).message}`);
	}

	const fmResult = SpecFrontmatterSchema.safeParse(rawFm);
	if (!fmResult.success) {
		const issues = fmResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
		throw new SpecValidationError(`Frontmatter validation failed: ${issues}`);
	}

	const fm = fmResult.data;

	// Validate context file paths
	for (const ctxPath of fm.context) {
		const abs = resolve(specDir, ctxPath);
		if (!existsSync(abs)) {
			throw new SpecValidationError(`Context file not found: ${ctxPath} (resolved to ${abs})`);
		}
	}

	// Validate depends-on references
	const taskIds = new Set(fm.tasks.map((t) => t.id));
	for (const task of fm.tasks) {
		for (const dep of task["depends-on"]) {
			if (!taskIds.has(dep)) {
				throw new SpecValidationError(`Task "${task.id}" depends-on "${dep}" which is not a declared task id`);
			}
		}
	}

	// Parse task body sections
	const taskBodies = new Map<string, string>();
	const sectionRegex = /^## (task-[\w-]+)\s*\n([\s\S]*?)(?=^## task-|$)/gm;
	for (const match of bodyStr.matchAll(sectionRegex)) {
		taskBodies.set(match[1].trim(), match[2].trim());
	}

	// Verify every declared task has a body
	for (const task of fm.tasks) {
		if (!taskBodies.has(task.id)) {
			throw new SpecValidationError(
				`Task "${task.id}" has no body section — add "## ${task.id}" to the markdown body`,
			);
		}
	}

	const tasks: ParsedTask[] = fm.tasks.map((t) => ({
		id: t.id,
		title: t.title,
		model: t.model,
		maxRetries: t["max-retries"],
		requiresScreenshots: t["requires-screenshots"],
		dependsOn: t["depends-on"],
		description: taskBodies.get(t.id)!,
	}));

	return {
		feature: fm.feature,
		contextFiles: fm.context.map((p) => resolve(specDir, p)),
		tasks,
	};
}
