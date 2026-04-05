// Simple math CLI consumer
// Tries to dynamically import a local ./math.js module if present, otherwise falls back
// to built-in implementations. Designed to be safe if the math module doesn't exist.

export type Op = "add" | "sub" | "mul" | "div";

export async function compute(op: Op, a: number, b: number): Promise<number> {
	let math: { add?: (x:number,y:number)=>number; sub?: (x:number,y:number)=>number; mul?: (x:number,y:number)=>number; div?: (x:number,y:number)=>number } | null = null;
	try {
		// Attempt to load a local math module (compiled JS) if available
		math = await import("./math.js");
	} catch (err) {
		// absent: fall back to simple implementations
		math = {
			add: (x,y) => x + y,
			sub: (x,y) => x - y,
			mul: (x,y) => x * y,
			div: (x,y) => x / y,
		};
	}

	switch (op) {
		case "add": return math.add!(a,b);
		case "sub": return math.sub!(a,b);
		case "mul": return math.mul!(a,b);
		case "div": return math.div!(a,b);
	}
}

export async function main(argv: string[] = process.argv.slice(2)) {
	if (argv.length < 3) {
		console.error("Usage: node math-cli.js <op> <a> <b>\nops: add, sub, mul, div");
		process.exit(2);
	}
	const op = argv[0] as Op;
	const a = Number(argv[1]);
	const b = Number(argv[2]);
	if (Number.isNaN(a) || Number.isNaN(b)) {
		console.error("Both operands must be numbers");
		process.exit(2);
	}
	try {
		const res = await compute(op, a, b);
		console.log(res);
		return res;
	} catch (err) {
		console.error("Error computing:", err);
		process.exit(1);
	}
}

// If executed directly with node, run main()
if (typeof process !== "undefined" && process.argv && process.argv[1] && process.argv[1].endsWith("math-cli.ts")) {
	// Note: when running TS directly this may or may not be true; consumers can import main()
	main().catch(() => process.exit(1));
}
