# learn-claude-agents — Project Context

## Study Plan

Howard is doing a **side-by-side study** of two repos to learn agent architecture patterns s01–s12:

| Repo | Path | Language | Style |
|------|------|----------|-------|
| learn-claude-code | `/Users/howard/learn-claude-code` | Python | Teaching-focused, minimal |
| learn-claude-agents | `/Users/howard/learn-claude-agents` | TypeScript/Pi | Production-grade |

**Progress tracker (source of truth):** `/Users/howard/learn-claude-code/STUDY_TRACKER.md`

## Reference Documents

| Doc | Path | Purpose |
|-----|------|---------|
| Study overview | `/Users/howard/howard_value/P.A.R.A/Projects/notebooklm/Agent 架構學習計畫 — s01-s12 雙語對照.md` | Full plan, bilingual |
| Python vs TypeScript deep dive | `/Users/howard/howard_value/P.A.R.A/Projects/agent-harness/PI/agent-loop-python-vs-typescript-2026-03-16.md` | API format, key diffs |
| S01 learning notes | `/Users/howard/howard_value/P.A.R.A/Projects/agent-harness/PI/S01 Agent While-Loop — learn-claude-agents 學習筆記.md` | Feynman notes, pi observations |

## 12 Patterns (s01–s12)

| Phase | Patterns | Core Concept |
|-------|----------|-------------|
| 1 — Loop | s01 Agent While-Loop, s02 Tool Dispatch Map | `while stop_reason == "tool_use"` is all you need |
| 2 — Planning | s03 Todo Write, s04 Subagent Isolation, s05 Skill Loading, s06 Context Compression | Plan before acting |
| 3 — Persistence | s07 Task Dependency Graph, s08 Background Task Lanes | File-based DAG, non-blocking lanes |
| 4 — Teams | s09 Agent Team Mailboxes, s10 FSM Protocols, s11 Autonomous Cycle, s12 Worktree Isolation | JSONL mailbox, git worktree per task |

## How to Check Progress

```bash
cat /Users/howard/learn-claude-code/STUDY_TRACKER.md
```

## Key Insight (already learned — s01)

The agent loop is a `while True` that feeds tool results back as `user` messages. Python 版 = bare minimum 30 lines. Pi TypeScript 版 = same skeleton + streaming + steering + event stream. Bone structure unchanged.
