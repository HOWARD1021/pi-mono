/**
 * Auto-Router Extension
 *
 * Automatically routes user messages to the optimal model tier based on
 * complexity classification. Uses gemini CLI (flash) for fast classification,
 * then switches pi to the appropriate model before the message is processed.
 *
 * Tiers: FLASH → flash, STANDARD → pro, SMART → opus
 * Commands: /auto → re-enable after manual model selection
 * Manual model selection locks routing until /auto is used.
 */

import { spawnSync } from "node:child_process";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ─── Debug logging ───────────────────────────────────────────────────────────

const DEBUG_LOG = "/tmp/pi-auto-router-debug.log";

function debugLog(entry: Record<string, unknown>) {
	try {
		const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
		spawnSync("tee", ["-a", DEBUG_LOG], {
			input: `${line}\n`,
			encoding: "utf8",
			stdio: ["pipe", "ignore", "ignore"],
		});
	} catch {
		// Silently ignore debug failures
	}
}

// ─── Tier map ────────────────────────────────────────────────────────────────

type Tier = "FLASH" | "STANDARD" | "SMART";

const TIER_MAP: Record<Tier, { provider: string; id: string }> = {
	FLASH: { provider: "gemini-cli", id: "flash" },
	STANDARD: { provider: "gemini-cli", id: "pro" },
	SMART: { provider: "claude-cli", id: "opus" },
};

// ─── State ───────────────────────────────────────────────────────────────────

let mode: "auto" | "locked" = "auto";
let lockedModel: Model<any> | null = null;
let routerSwitching = false;

// ─── Classification ──────────────────────────────────────────────────────────

const CLASSIFY_PROMPT = (message: string) =>
	`Classify this request into exactly one word: FLASH, STANDARD, or SMART.
FLASH = simple question, quick fact, single-step task, reading files
STANDARD = coding task, explanation, multi-step, refactoring
SMART = complex reasoning, architecture, hard debugging, system design

Request: ${message}

Reply with only one word: FLASH, STANDARD, or SMART`;

function classify(text: string): Tier {
	const snippet = text.slice(0, 500);
	const prompt = CLASSIFY_PROMPT(snippet);

	try {
		const result = spawnSync("gemini", ["-m", "gemini-2.5-flash", "--output-format", "text", prompt], {
			timeout: 10000,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		debugLog({
			event: "classify",
			status: result.status,
			stdout: result.stdout?.trim().slice(0, 50),
			stderr: result.stderr?.trim().slice(0, 100),
		});

		if (result.status === 0 && result.stdout) {
			const word = result.stdout.trim().split(/\s+/)[0].toUpperCase();
			if (word === "FLASH" || word === "STANDARD" || word === "SMART") {
				return word;
			}
		}
	} catch (err) {
		debugLog({ event: "classify_error", error: String(err) });
	}

	// Default to STANDARD on any failure
	debugLog({ event: "classify_fallback", tier: "STANDARD" });
	return "STANDARD";
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function updateStatus(ctx: ExtensionContext, tier?: string) {
	if (mode === "locked" && lockedModel) {
		ctx.ui.setStatus("auto-router", ctx.ui.theme.fg("warning", `[locked: ${lockedModel.id}]`));
	} else if (tier) {
		ctx.ui.setStatus("auto-router", ctx.ui.theme.fg("accent", `[auto: ${tier.toLowerCase()}]`));
	} else {
		ctx.ui.setStatus("auto-router", ctx.ui.theme.fg("accent", "[auto]"));
	}
}

// ─── Extension entry point ───────────────────────────────────────────────────

export default function autoRouterExtension(pi: ExtensionAPI) {
	// ── /auto command: re-enable auto-routing ────────────────────────────────

	pi.registerCommand("auto", {
		description: "Re-enable automatic model routing",
		handler: async (_args, ctx) => {
			mode = "auto";
			lockedModel = null;
			updateStatus(ctx);
			ctx.ui.notify("Auto-routing enabled", "info");
			debugLog({ event: "auto_command", mode: "auto" });
		},
	});

	// ── session_start: initialize state, verify tier models ──────────────────

	pi.on("session_start", async (_event, ctx) => {
		mode = "auto";
		lockedModel = null;
		routerSwitching = false;

		// Verify all tier models are registered
		for (const [tier, { provider, id }] of Object.entries(TIER_MAP)) {
			const model = ctx.modelRegistry.find(provider, id);
			if (!model) {
				ctx.ui.notify(`auto-router: model ${provider}/${id} (${tier}) not found — is multi-cli loaded?`, "warning");
				debugLog({ event: "model_missing", tier, provider, id });
			}
		}

		updateStatus(ctx);
		debugLog({ event: "session_start", mode });
	});

	// ── model_select: detect manual model changes → lock routing ─────────────

	pi.on("model_select", async (event, ctx) => {
		// Ignore model changes triggered by the router itself
		if (routerSwitching) {
			return;
		}

		// User manually selected a model — lock to it
		mode = "locked";
		lockedModel = event.model;
		updateStatus(ctx);
		debugLog({
			event: "model_select_lock",
			model: event.model.id,
			provider: event.model.provider,
			source: event.source,
		});
	});

	// ── input: classify and route ────────────────────────────────────────────

	pi.on("input", async (event, ctx) => {
		// Skip extension-injected messages
		if (event.source === "extension") {
			return { action: "continue" as const };
		}

		// If locked, let the message through on the current model
		if (mode === "locked") {
			debugLog({ event: "input_locked", model: lockedModel?.id });
			return { action: "continue" as const };
		}

		// Classify the message
		const tier = classify(event.text);
		const target = TIER_MAP[tier];
		const model = ctx.modelRegistry.find(target.provider, target.id);

		debugLog({
			event: "input_route",
			tier,
			provider: target.provider,
			model: target.id,
			found: !!model,
		});

		if (model) {
			// Set the router flag so model_select doesn't lock
			routerSwitching = true;
			const success = await pi.setModel(model);
			routerSwitching = false;

			if (!success) {
				debugLog({ event: "setModel_failed", tier, provider: target.provider, id: target.id });
				ctx.ui.notify(`auto-router: failed to switch to ${target.provider}/${target.id}`, "warning");
			}
		}

		updateStatus(ctx, tier);
		return { action: "continue" as const };
	});
}
