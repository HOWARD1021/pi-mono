#!/bin/bash
# 最簡單版本 - 直接看原始 JSON

tail -f /Users/howard/pi-mono-app-factory-workflow/.pi/debug/flow-trace.log | jq -C .
