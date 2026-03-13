# Local CLI Provider Extension

This example registers a `local-cli` provider that shells out to a local CLI process instead of calling an HTTP API directly.

## Quick start

```bash
pi -e ./packages/coding-agent/examples/extensions/custom-provider-local-cli
```

Then select:

```text
/model local-cli/standard
```

## Defaults

By default this mirrors `Tools/Inference.ts` and spawns:

```bash
claude --print --model sonnet --tools '' --output-format text --setting-sources '' --system-prompt "<prompt>" "<conversation>"
```

The extension exposes three models:

- `local-cli/fast`
- `local-cli/standard`
- `local-cli/smart`

## Environment overrides

```bash
export LOCAL_CLI_COMMAND=claude
export LOCAL_CLI_ARGS_JSON='["--print","--model","{{model}}","--tools","","--output-format","text","--setting-sources","","--system-prompt","{{systemPrompt}}","{{conversation}}"]'
export LOCAL_CLI_FAST_MODEL=haiku
export LOCAL_CLI_STANDARD_MODEL=sonnet
export LOCAL_CLI_SMART_MODEL=opus
```

Supported placeholders inside `LOCAL_CLI_ARGS_JSON`:

- `{{model}}`
- `{{systemPrompt}}`
- `{{conversation}}`
- `{{userPrompt}}`
- `{{cwd}}`

## Limitations

- This bridge is text-only.
- It does not translate pi tool calls into the child CLI's tool protocol.
- If you want deeper integration, use this as a starting point and teach `streamLocalCli()` how to encode/decode tool calls for your target CLI.
