import { readFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_CHAR_LIMIT = 16_000; // ~4k tokens per file across multiple files

export function loadContext(filePaths: string[], charLimit = DEFAULT_CHAR_LIMIT): string {
	if (filePaths.length === 0) return "";

	const perFile = Math.floor(charLimit / filePaths.length);
	const sections: string[] = [];

	for (const filePath of filePaths) {
		const content = readFileSync(filePath, "utf8");
		const truncated = content.length > perFile ? content.slice(0, perFile) + "\n...[truncated]" : content;
		sections.push(`### Context: ${basename(filePath)}\n\n${truncated}`);
	}

	return sections.join("\n\n---\n\n");
}
