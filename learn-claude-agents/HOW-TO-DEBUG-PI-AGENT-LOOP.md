# How to Debug Pi's Agent Loop (S01 Style)

> See what happens behind the scenes when pi runs the agent while-loop

Based on the s01 lesson from learn-claude-agents, here's how to observe pi's internal agent loop in action.

## Quick Start: Built-in Debugging

### 1. Enable Flow Tracing Extension

```bash
cd /Users/howard/pi-mono-app-factory-workflow

# Start pi with your agent-flow-tracer extension
pi --extension .pi/extensions/agent-flow-tracer.ts
```

### 2. Run Some Commands and Watch

```bash
# In pi, try:
Create a file called hello.py that prints "Hello, World!"

# Then view the trace
/trace:view
```

### 3. See Full Details

```bash
# Outside pi, read the trace log:
cat /Users/howard/pi-mono-app-factory-workflow/.pi/debug/flow-trace.log | jq
```

## What You'll See: The Agent Loop in Action

### Trace Event Phases

Your tracer logs events in 5 phases that map to the s01 agent loop:

| Phase | What It Tracks | Corresponds to S01 |
|-------|----------------|-------------------|
| `lifecycle` | session_start, session_shutdown | Setup/teardown |
| `agent` | turn_start, agent_start, agent_end, turn_end | The while loop |
| `llm` | before_provider_request | Calling client.messages.create() |
| `message` | message_start, message_end | LLM response streaming |
| `tool` | tool_execution_start/end | run_bash(), read_file(), etc. |

### Example Trace Output

```json
{
  "timestamp": "2026-03-14T10:30:00.123Z",
  "sequenceId": 0,
  "eventType": "turn_start",
  "phase": "agent",
  "data": {
    "turnId": "turn-abc123",
    "userMessage": "Create a file hello.py..."
  }
}

{
  "sequenceId": 1,
  "eventType": "before_provider_request",
  "phase": "llm",
  "data": {
    "provider": "google-antigravity",
    "model": "gemini-3.1-pro-high",
    "messageCount": 3
  }
}

{
  "sequenceId": 2,
  "eventType": "message_start",
  "phase": "message",
  "data": {
    "messageId": "msg_001"
  }
}

{
  "sequenceId": 3,
  "eventType": "tool_execution_start",
  "phase": "tool",
  "data": {
    "toolName": "write",
    "argsPreview": "{\"file_path\":\"hello.py\",\"content\":\"print('Hello...\""
  }
}

{
  "sequenceId": 4,
  "eventType": "tool_execution_end",
  "phase": "tool",
  "data": {
    "toolName": "write",
    "isError": false
  }
}

{
  "sequenceId": 5,
  "eventType": "message_end",
  "phase": "message",
  "data": {
    "stopReason": "stop",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 56
    }
  }
}

{
  "sequenceId": 6,
  "eventType": "turn_end",
  "phase": "agent",
  "data": {
    "turnId": "turn-abc123"
  }
}
```

## Mapping to S01 Python Code

### The While Loop

**S01 Python:**
```python
def agent_loop(query):
    messages = [{"role": "user", "content": query}]
    while True:                                          # ← THE LOOP
        response = client.messages.create(...)           # ← LLM call
        messages.append({"role": "assistant", ...})
        
        if response.stop_reason != "tool_use":           # ← Exit condition
            return
        
        # Execute tools and loop back
        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = run_bash(block.input["command"])
                results.append(...)
        messages.append({"role": "user", "content": results})
```

**Pi Events:**
```
turn_start                    ← while loop starts
  → agent_start
  → before_provider_request   ← client.messages.create() about to be called
  → message_start             ← LLM streaming begins
  → [text deltas...]
  → tool_execution_start      ← if block.type == "tool_use":
  → tool_execution_end        ←   output = run_bash(...)
  → message_end               ← response complete
  → (if stop_reason != "tool_use", exit)
  → (else, loop back to before_provider_request)
  → agent_end                 ← loop exited
turn_end                      ← while loop done
```

## Multi-CLI Debug Log

You also have a second debug stream for CLI-based providers:

```bash
tail -f /tmp/pi-multi-cli-debug.log
```

**What it shows:**
- Exact CLI commands being executed (`gemini -m gemini-2.5-flash --yolo ...`)
- Message count and tool count sent to LLM
- Response preview and token usage

**Example:**
```json
{
  "event": "streamCliWithTools_called",
  "systemPrompt": "You are an expert coding assistant...",
  "messageCount": 1,
  "toolCount": 4,
  "allMessages": [{"role": "user", "contentPreview": "hi"}]
}

{
  "event": "call_start",
  "provider": "gemini-cli",
  "command": "gemini",
  "args": ["-m", "gemini-2.5-flash", "--yolo", "hi"]
}

{
  "event": "call_done",
  "usage": {
    "input": 8549,
    "output": 10,
    "totalTokens": 8559
  }
}
```

## Interactive Debugging Workflow

### Step 1: Clear Old Traces

```bash
# In pi:
/trace:clear
```

### Step 2: Execute a Multi-Tool Task

```bash
# Something that will require multiple tool calls
Read the file README.md, then create a summary.txt with the first 3 sections
```

### Step 3: Analyze the Loop

```bash
/trace:view
```

You'll see multiple iterations:

```
1. turn_start
2. before_provider_request (messageCount: 1)
3. tool_execution_start (read README.md)
4. tool_execution_end
5. before_provider_request (messageCount: 3)  ← Loop iteration 2!
6. tool_execution_start (write summary.txt)
7. tool_execution_end
8. before_provider_request (messageCount: 5)  ← Loop iteration 3!
9. message_end (stopReason: "stop")           ← Exit!
10. turn_end
```

### Step 4: Deep Dive

```bash
# Outside pi, use jq to filter specific phases:
cat .pi/debug/flow-trace.log | jq 'select(.phase == "tool")'

# Or count loop iterations:
cat .pi/debug/flow-trace.log | jq 'select(.eventType == "before_provider_request")' | wc -l
```

## Advanced: Add Your Own Trace Points

Edit `.pi/extensions/agent-flow-tracer.ts`:

```typescript
// Add a custom event to track message content
pi.on("message_end", (event: any, ctx: ExtensionContext) => {
  log("message_end", "message", {
    turnId: currentTurnId,
    stopReason: event.stopReason,
    usage: event.usage,
    
    // NEW: Log full message content
    fullContent: event.message?.content,
    toolCallCount: event.message?.content?.filter(
      (c: any) => c.type === "toolCall"
    ).length,
  });
});
```

## Understanding the Stop Condition

**S01 uses `stop_reason != "tool_use"` to exit the loop.**

In pi, you can observe this in the trace:

```bash
# Find all message_end events and check stopReason:
cat .pi/debug/flow-trace.log | jq 'select(.eventType == "message_end") | .data.stopReason'
```

Possible values:
- `"toolCalls"` → Loop continues (has tools to execute)
- `"stop"` → Loop exits (LLM finished)
- `"length"` → Loop exits (hit max tokens)

## Visualize the Agent Loop

Create a simple script to visualize turn structure:

```bash
#!/bin/bash
# viz-turns.sh

echo "=== Agent Loop Visualization ==="
echo

turn_num=0
cat .pi/debug/flow-trace.log | jq -r '
  if .eventType == "turn_start" then
    "🟢 TURN START"
  elif .eventType == "before_provider_request" then
    "  ├─ 💭 LLM Call (messages: \(.data.messageCount))"
  elif .eventType == "tool_execution_start" then
    "  ├─ 🔧 Tool: \(.data.toolName)"
  elif .eventType == "message_end" then
    "  └─ ✅ Stop: \(.data.stopReason) | Tokens: \(.data.usage.inputTokens + .data.usage.outputTokens)"
  elif .eventType == "turn_end" then
    "🔴 TURN END\n"
  else
    empty
  end
'
```

Run it:
```bash
chmod +x viz-turns.sh
./viz-turns.sh
```

Output:
```
🟢 TURN START
  ├─ 💭 LLM Call (messages: 1)
  ├─ 🔧 Tool: read
  ├─ 💭 LLM Call (messages: 3)
  ├─ 🔧 Tool: write
  ├─ 💭 LLM Call (messages: 5)
  └─ ✅ Stop: stop | Tokens: 1890
🔴 TURN END
```

## Common Patterns to Watch For

### Pattern 1: Single-Shot (No Tools)

```
turn_start → before_provider_request → message_end (stop) → turn_end
```

**Example:** User asks "What is 2+2?"

### Pattern 2: Tool Loop (S01 Classic)

```
turn_start
  → before_provider_request (msg: 1)
  → tool_execution (read)
  → before_provider_request (msg: 3)   ← loop iteration!
  → tool_execution (write)
  → before_provider_request (msg: 5)   ← loop iteration!
  → message_end (stop)
turn_end
```

**Example:** User asks "Create hello.py based on README.md"

### Pattern 3: Max Context Hit

```
turn_start
  → before_provider_request (msg: 1)
  → tool_execution (read large_file.txt)
  → before_provider_request (msg: 3)
  → message_end (length)  ← stopped due to token limit!
turn_end
```

## Compare with Other Lessons

| Lesson | Pi Equivalent | How to Trace |
|--------|---------------|--------------|
| s02 (Tool Dispatch) | `tool_execution_start` event | Filter `phase == "tool"` |
| s03 (TodoWrite) | Custom extension with `turn_end` handler | Add your own log() calls |
| s04 (Subagent) | Use Task tool (spawns separate session) | Each subagent gets own trace |
| s06 (Context Compression) | Session compaction (auto-compact) | Track `messageCount` growth |

## Troubleshooting

### No trace events appearing?

```bash
# Check if extension loaded:
ls -la .pi/debug/flow-trace.log

# If missing, ensure extension is loaded:
pi --extension .pi/extensions/agent-flow-tracer.ts

# In pi, verify:
/trace:view
```

### Want to see raw messages array?

Edit agent-flow-tracer.ts:

```typescript
pi.on("before_provider_request", (event: any, ctx: ExtensionContext) => {
  log("before_provider_request", "llm", {
    // ... existing fields ...
    
    // ADD THIS:
    messages: event.messages,  // Full message history!
  });
});
```

### Track specific tool usage:

```typescript
pi.on("tool_execution_end", (event: any, ctx: ExtensionContext) => {
  if (event.toolName === "bash") {
    // Special logging for bash commands
    log("bash_execution_detail", "tool", {
      command: event.args?.command,
      exitCode: event.result?.exitCode,
      stdout: event.result?.stdout?.slice(0, 200),
    });
  }
});
```

## Summary: S01 Concepts in Pi

| S01 Concept | Pi Implementation | How to Observe |
|-------------|-------------------|----------------|
| `while True` | Agent runtime loop | Count `before_provider_request` events |
| `messages.append()` | Session message history | Track `messageCount` growth |
| `response = client.messages.create()` | Provider API call | `before_provider_request` + `message_start` |
| `if response.stop_reason != "tool_use"` | Stop condition check | `message_end.stopReason` |
| `for block in response.content` | Tool call iteration | `tool_execution_start/end` sequence |
| `run_bash(block.input)` | Tool handler dispatch | `tool_execution_end.result` |

## Next Steps

1. **Study s02-s06** with pi tracing enabled to see dispatch maps, todos, subagents, and compression
2. **Build your own extension** that uses these events to implement s03 (TodoWrite) or s07 (Task Graph)
3. **Profile token usage** by aggregating `message_end.usage` across turns
4. **Implement s08 (Background Tasks)** using pi's extension API

**The agent loop is simple. Tracing makes it visible. Extensions make it powerful.**
