# 快速開始：即時監看 Pi Agent Loop

## 最簡單的方式

### 方法 1: 直接看原始 log (有顏色)

```bash
./watch-simple.sh
```

### 方法 2: 看格式化的 loop 流程

```bash
./watch-pi-loop.sh
```

輸出範例：
```
🟢 10:30:15 TURN START
  ├─ 💭 LLM Call (messages: 1)
  ├─ 🔧 write {"file_path":"hello.py"...
  │  └─ ✅ Success
  ├─ 💭 LLM Call (messages: 3)
  └─ 🏁 Stop: stop | Tokens: 1234
🔴 TURN END
```

### 方法 3: 只看工具執行

```bash
tail -f ~/.pi-mono-app-factory-workflow/.pi/debug/flow-trace.log | \
  jq -C 'select(.phase == "tool")'
```

### 方法 4: 只看 LLM 呼叫

```bash
tail -f ~/.pi-mono-app-factory-workflow/.pi/debug/flow-trace.log | \
  jq -C 'select(.phase == "llm")'
```

### 方法 5: 監看 CLI provider (Gemini/Claude)

```bash
tail -f /tmp/pi-multi-cli-debug.log | jq -C .
```

## 使用流程

### Terminal 1: 啟動監看
```bash
cd /Users/howard/learn-claude-agents
./watch-pi-loop.sh
```

### Terminal 2: 執行 pi
```bash
cd /Users/howard/pi-mono-app-factory-workflow
pi --extension .pi/extensions/agent-flow-tracer.ts

# 在 pi 裡執行任何指令，例如：
Create a file called hello.py that prints "Hello, World!"
```

### Terminal 1 會即時顯示：
```
🟢 10:35:20 TURN START
  ├─ 💭 LLM Call (messages: 1)
  ├─ 🔧 write
  │  └─ ✅ Success
  ├─ 💭 LLM Call (messages: 3)  ← 這就是 while loop 的第二次迭代！
  └─ 🏁 Stop: stop | Tokens: 890
🔴 TURN END
```

## 對應到 s01 的 while loop

```python
while True:                           # 🟢 TURN START
    response = client.messages.create(...)  # 💭 LLM Call
    
    if response.stop_reason != "tool_use":  # 🏁 Stop: stop
        return                               # 🔴 TURN END
    
    for block in response.content:
        if block.type == "tool_use":        # 🔧 tool_execution
            output = run_bash(...)           # ✅ Success
```

## 只想看特定資訊？

### 計算 loop 跑了幾次
```bash
grep -c "before_provider_request" \
  /Users/howard/pi-mono-app-factory-workflow/.pi/debug/flow-trace.log
```

### 看所有用過的 tools
```bash
jq -r 'select(.eventType == "tool_execution_start") | .data.toolName' \
  /Users/howard/pi-mono-app-factory-workflow/.pi/debug/flow-trace.log | \
  sort | uniq -c
```

### 看 token 使用量
```bash
jq -r 'select(.eventType == "message_end") | 
  "Tokens: \((.data.usage.inputTokens // 0) + (.data.usage.outputTokens // 0))"' \
  /Users/howard/pi-mono-app-factory-workflow/.pi/debug/flow-trace.log
```

就這麼簡單！
