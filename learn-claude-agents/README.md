# Learn Claude Agents - Course Notes

Source: https://learn-claude-agents.vercel.app

## Course Progression

### Foundations (s01-s06)
| Lesson | Topic | Key Concept |
|--------|-------|-------------|
| [s01](s01-agent-while-loop.md) | The Agent While-Loop | One loop + bash = an agent |
| [s02](s02-tool-dispatch-map.md) | Tool Dispatch Map | Dict maps tool names to handlers |
| [s03](s03-todo-write-nag.md) | TodoWrite Nag System | Plan before executing, nag to stay on track |
| [s04](s04-subagent-context-isolation.md) | Subagent Context Isolation | Fresh context per subtask |
| [s05](s05-on-demand-skill-loading.md) | On-Demand Skill Loading | Two-layer: names in system prompt, body on demand |
| [s06](s06-context-compression.md) | Three-Layer Context Compression | micro_compact -> auto_compact -> manual compact |

### Multi-Agent (s07-s12)
| Lesson | Topic | Key Concept |
|--------|-------|-------------|
| [s07](s07-task-dependency-graph.md) | Task Dependency Graph | File-based DAG with blockedBy/blocks |
| [s08](s08-background-task-lanes.md) | Background Task Lanes | Daemon threads + notification queue |
| [s09](s09-agent-team-mailboxes.md) | Agent Team Mailboxes | Persistent teammates + JSONL inboxes |
| [s10](s10-fsm-team-protocols.md) | FSM Team Protocols | Request-response with correlated IDs |
| [s11](s11-autonomous-agent-cycle.md) | Autonomous Agent Cycle | idle-poll-claim-work self-governing loop |
| [s12](s12-worktree-task-isolation.md) | Worktree Task Isolation | Git worktrees bound to tasks by ID |

## Architecture Evolution

```
s01: while loop + bash
 |
s02: + dispatch map (read/write/edit tools)
 |
s03: + TodoManager + nag reminders
 |
s04: + subagent context isolation
 |
s05: + on-demand skill loading
 |
s06: + three-layer context compression
 |
s07: + file-based task dependency graph
 |
s08: + background daemon threads
 |
s09: + persistent teammates + mailboxes
 |
s10: + FSM protocols (shutdown, plan approval)
 |
s11: + autonomous idle-poll-claim-work cycle
 |
s12: + git worktree isolation per task
```

## Debugging: See Pi's Agent Loop in Action

**📖 [HOW-TO-DEBUG-PI-AGENT-LOOP.md](HOW-TO-DEBUG-PI-AGENT-LOOP.md)**

Learn how to use pi's built-in tracing to observe the agent while-loop from s01 in real-time:

- Enable flow tracing extension
- See turn_start → before_provider_request → tool_execution → message_end → turn_end
- Map pi events to s01 Python code
- Debug multi-CLI providers (Gemini, Claude)
- Visualize loop iterations and stop conditions

Quick start:
```bash
cd /Users/howard/pi-mono-app-factory-workflow
pi --extension .pi/extensions/agent-flow-tracer.ts

# In pi:
Create a file hello.py
/trace:view
```
