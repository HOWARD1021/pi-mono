#!/bin/bash
# 清楚地顯示 agent loop，只顯示關鍵資訊

tail -f /tmp/pi-multi-cli-debug.log | jq -r --unbuffered '
  if .event == "streamCliWithTools_called" then
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🟢 NEW TURN | Messages: \(.messageCount)\n📝 User: \(.allMessages[0].contentPreview // "N/A")\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  elif .event == "tool_use" then
    "  🔧 Tool: \(.tool)\n     Input: \(.input_preview)"
  
  elif .event == "tool_result" then
    "     ✅ Output: \(.output_preview)\n"
  
  elif .event == "call_done" then
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏁 DONE | Tokens: input=\(.usage.input) output=\(.usage.output) total=\(.usage.totalTokens)\n💬 Response: \(.response_preview)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
  
  else
    empty
  end
'
