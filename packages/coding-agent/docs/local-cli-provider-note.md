# Local CLI Provider Note

## Summary

This note captures the completed work for a prototype `pi-coding-agent` provider that shells out to a local CLI instead of calling an HTTP model API directly.

## Completed

- Added `examples/newagent.ts` as a simpler, app-facing example that uses the high-level `Agent` API instead of the lower-level `agentLoop()` example.
- Added `packages/coding-agent/examples/extensions/custom-provider-local-cli/` as a new extension example.
- Implemented a `local-cli` provider via `pi.registerProvider("local-cli", ...)`.
- Implemented a custom `streamSimple` bridge that:
  - spawns a local CLI subprocess with `node:child_process`
  - captures `stdout` and `stderr`
  - applies timeout and abort handling
  - converts CLI output into a `pi-ai` assistant message event stream
- Mirrored the design of `Tools/Inference.ts` by default:
  - default command is `claude`
  - default model tiers are `fast`, `standard`, `smart`
  - default arguments are a plain text, no-tools, one-shot invocation
- Added environment-based customization:
  - `LOCAL_CLI_COMMAND`
  - `LOCAL_CLI_ARGS_JSON`
  - `LOCAL_CLI_FAST_MODEL`
  - `LOCAL_CLI_STANDARD_MODEL`
  - `LOCAL_CLI_SMART_MODEL`
  - timeout env vars per tier
  - `LOCAL_CLI_STRIP_ENV_VARS`
- Registered three provider models:
  - `local-cli/fast`
  - `local-cli/standard`
  - `local-cli/smart`
- Added example packaging so the extension can be loaded as a directory:
  - `package.json`
  - `README.md`
- Updated `packages/coding-agent/examples/extensions/README.md` to list the new example.

## Verification Completed

- Built the required packages successfully:
  - `@mariozechner/pi-tui`
  - `@mariozechner/pi-ai`
  - `@mariozechner/pi-agent-core`
  - `@mariozechner/pi-coding-agent`
- Verified the new extension loads and registers `local-cli`.
- Verified `pi` can list the registered models:
  - `local-cli/fast`
  - `local-cli/standard`
  - `local-cli/smart`
- Verified the provider bridge end-to-end with a fake local CLI using `python3`.
- Verified direct `gemini` CLI one-shot invocation works on the machine.

## Current Constraints

- The provider is text-only.
- It does not translate `pi` tool calls into the child CLI's native tool protocol.
- The prompt bridge currently serializes conversation state into plain text.
- The `pi -p` path appears to hang during shutdown/print-mode completion in this environment even when the spawned CLI finishes successfully.

## Files Added

- `examples/newagent.ts`
- `packages/coding-agent/examples/extensions/custom-provider-local-cli/index.ts`
- `packages/coding-agent/examples/extensions/custom-provider-local-cli/package.json`
- `packages/coding-agent/examples/extensions/custom-provider-local-cli/README.md`

## Files Updated

- `packages/coding-agent/examples/extensions/README.md`
