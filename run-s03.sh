#!/bin/bash
# Run s03 TodoWrite with local model — from learn-claude-agents directory
# Usage: ./run-s03.sh [optional prompt]

cd /Users/howard/learn-claude-agents

PROMPT="${1:-Create a Python package with __init__.py, utils.py, and tests/test_utils.py with type hints and docstrings}"

echo "🧪 s03 TodoWrite — local model"
echo "📂 cwd: $(pwd)"
echo "💬 prompt: $PROMPT"
echo "────────────────────────────"
echo ""

echo "$PROMPT" | python3 ../learn-claude-code/agents/s03_todo_write_local.py
