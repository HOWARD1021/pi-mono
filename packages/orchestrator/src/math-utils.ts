// Lightweight math utilities used by the orchestrator package

export const clamp = (value: number, min: number, max: number): number => {
	if (min > max) [min, max] = [max, min];
	return Math.min(Math.max(value, min), max);
};

export const sum = (numbers: number[]): number => numbers.reduce((s, n) => s + n, 0);

export const mean = (numbers: number[]): number => {
	if (!numbers || numbers.length === 0) return NaN;
	return sum(numbers) / numbers.length;
};

export const median = (numbers: number[]): number => {
	if (!numbers || numbers.length === 0) return NaN;
	const arr = [...numbers].sort((a, b) => a - b);
	const mid = Math.floor(arr.length / 2);
	return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
};

export const roundTo = (value: number, decimals = 0): number => {
	const p = 10 ** decimals;
	return Math.round(value * p) / p;
};

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export default {
	clamp,
	clamp01,
	sum,
	mean,
	median,
	roundTo,
};
