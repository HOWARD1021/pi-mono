# Local CLI Provider Plan

## Goal

Turn the `local-cli` prototype into a reliable custom provider path for local CLI-backed models such as `gemini`, `claude`, or other wrappers.

## Open Issues

- Investigate why `pi -p` does not exit cleanly after the spawned local CLI returns.
- Confirm whether the hang is in:
  - `runPrintMode()`
  - session shutdown
  - stdout drain handling
  - event stream completion semantics
- Verify the behavior with both:
  - `claude`
  - `gemini`

## Todo

- Reproduce the print-mode hang with a minimal deterministic command.
- Compare the custom provider event lifecycle against built-in providers that complete correctly in print mode.
- Add temporary logging around:
  - `streamSimple` completion
  - assistant message finalization
  - `runPrintMode()`
  - session shutdown
- Confirm whether the provider should emit any additional terminal events or flush semantics before `done`.
- Check whether `process.stdout.writableLength` or print-mode drain handling is blocking exit.
- Verify whether session persistence interacts badly with this provider in print mode.

## Provider Improvements

- Add a ready-made `gemini` preset so users do not need to pass `LOCAL_CLI_ARGS_JSON` manually.
- Add a ready-made `claude` preset with clearer documentation.
- Support model-specific argument builders instead of a single raw JSON args template.
- Allow per-provider prompt shaping instead of one generic text serialization strategy.
- Improve child environment control, including allow/deny lists for inherited env vars.

## Tooling Improvements

- Explore mapping `pi` tool calls to child CLI tool invocations for CLIs that support tools.
- Decide whether tool support should be:
  - unsupported and documented
  - emulated through plain text
  - bridged through a dedicated protocol adapter

## Documentation Todo

- Add a short section to `packages/coding-agent/docs/custom-provider.md` referencing the local CLI example.
- Add "how to run from source" guidance for developers who do not have `pi` installed globally.
- Document `PI_CODING_AGENT_DIR=.pi/agent` as a useful local-testing pattern.
- Document tested `gemini` invocation parameters.

## Validation Todo

- Re-run end-to-end validation after fixing print-mode shutdown.
- Test in interactive mode and print mode.
- Test with:
  - fake CLI
  - `gemini`
  - `claude`
- Verify session files are written correctly and do not corrupt resume behavior.
- Confirm no hanging subprocesses remain after normal completion.

## Nice To Have

- Add an automated test fixture for a fake local CLI process.
- Add a regression test for print-mode completion.
- Promote the example from prototype status once shutdown behavior is stable.
