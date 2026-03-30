#!/bin/bash
# 即時監看 Pi Agent Loop
# 用法: ./watch-pi-loop.sh

echo "🔍 Watching Pi Agent Loop..."
echo "================================"
echo ""

# 檢查 flow-trace.log 是否存在
# 用法: ./watch-pi-loop.sh [目錄路徑]  (預設: 目前目錄)
TARGET_DIR="${1:-$(pwd)}"
FLOW_LOG="${TARGET_DIR}/.pi/debug/flow-trace.log"
CLI_LOG="/tmp/pi-multi-cli-debug.log"

echo "📂 監看目錄: $TARGET_DIR"
echo "📄 Log 路徑: $FLOW_LOG"
echo ""

if [ ! -f "$FLOW_LOG" ]; then
    echo "⚠️  Flow trace log 不存在，等待 pi 建立..."
    echo "   (確認 agent-flow-tracer 已在全域 settings 載入)"
    echo ""
    # 等待 log 檔出現
    while [ ! -f "$FLOW_LOG" ]; do sleep 1; done
    echo "✅ Log 檔出現，開始監看..."
    echo ""
fi

echo "📊 即時顯示 agent loop 事件："
echo ""

# 即時監看，只顯示關鍵欄位
tail -f "$FLOW_LOG" 2>/dev/null | while read line; do
    # 解析 JSON 並格式化輸出
    echo "$line" | jq -r '
        if .eventType == "turn_start" then
            "🟢 \(.timestamp | split("T")[1] | split(".")[0]) TURN START"
        elif .eventType == "before_provider_request" then
            "  ├─ 💭 LLM Call (messages: \(.data.messageCount))"
        elif .eventType == "tool_execution_start" then
            "  ├─ 🔧 \(.data.toolName) \(.data.argsPreview // "")"
        elif .eventType == "tool_execution_end" then
            if .data.isError then
                "  │  └─ ❌ Failed"
            else
                "  │  └─ ✅ Success"
            end
        elif .eventType == "message_end" then
            "  └─ 🏁 Stop: \(.data.stopReason) | Tokens: \((.data.usage.inputTokens // 0) + (.data.usage.outputTokens // 0))"
        elif .eventType == "turn_end" then
            "🔴 TURN END\n"
        else
            "  │  \(.eventType)"
        end
    ' 2>/dev/null || echo "$line"
done
