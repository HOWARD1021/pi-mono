export interface FreqEntry {
	word: string;
	count: number;
}

export interface AnalyzeOptions {
	minLength?: number;
	skipStopWords?: boolean;
}

const DEFAULT_STOP_WORDS = new Set([
	"the",
	"is",
	"at",
	"which",
	"on",
	"and",
	"a",
	"an",
	"of",
	"to",
	"in",
	"for",
	"with",
	"that",
	"this",
	"it",
	"as",
]);

export function analyze(text: string, opts: AnalyzeOptions = {}): FreqEntry[] {
	const minLength = opts.minLength ?? 1;
	const skipStopWords = opts.skipStopWords ?? false;

	if (!text) return [];

	// Normalize: lowercase and replace non-word characters with spaces
	const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ");
	const parts = normalized.split(/\s+/).filter(Boolean);
	const counts = new Map<string, number>();

	for (const raw of parts) {
		const w = raw.replace(/^'+|'+$/g, ""); // trim surrounding apostrophes
		if (w.length < minLength) continue;
		if (skipStopWords && DEFAULT_STOP_WORDS.has(w)) continue;
		counts.set(w, (counts.get(w) ?? 0) + 1);
	}

	const entries: FreqEntry[] = Array.from(counts.entries()).map(([word, count]) => ({ word, count }));
	entries.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
	return entries;
}

export function topN(text: string, n = 10, opts: AnalyzeOptions = {}): FreqEntry[] {
	return analyze(text, opts).slice(0, n);
}

export default { analyze, topN };
