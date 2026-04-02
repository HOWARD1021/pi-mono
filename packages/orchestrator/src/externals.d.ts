// Type declarations for external Pi packages that may not be installed locally.
// These are runtime dependencies resolved in the monorepo or at deploy time.

declare module "@mariozechner/pi-coding-agent/modes" {
	import type { AgentEvent } from "@mariozechner/pi-agent-core";

	export interface RpcClientOptions {
		cwd?: string;
		model?: string;
		provider?: string;
		env?: Record<string, string>;
	}

	export class RpcClient {
		constructor(options?: RpcClientOptions);
		start(): Promise<void>;
		stop(): Promise<void>;
		prompt(text: string): Promise<void>;
		waitForIdle(): Promise<void>;
		getLastAssistantText(): Promise<string | null>;
		onEvent(listener: (event: AgentEvent) => void): () => void;
	}
}

declare module "@mariozechner/pi-agent-core" {
	export interface AgentEvent {
		type: string;
		message?: {
			role: string;
			content: Array<{ type: string; text?: string }>;
		};
	}
}
