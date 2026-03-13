# App Factory Extension

OpenSpec-aligned workflow extension for building reusable fullstack product changes.

## Commands

- `/app:new <change-id>`: create `openspec/changes/<change-id>/`
- `/app:intake`: capture concept, purpose, stack notes, and UI/UX references
- `/app:spec`: generate `proposal.md`, `design.md`, `specs/`, `tasks.md`, `acceptance.md`, and `retro.md`
- `/app:approve`: unlock implementation after human review
- `/app:status`: show current workflow summary
- `/app:apply`: execute the next approved task and require `[APP_TASK_DONE:<id>]` markers
- `/app:verify`: ask the agent to verify the change against spec and acceptance artifacts
- `/app:retro`: ask the agent for a retrospective
- `/app:archive`: move the change into `openspec/changes/archive/`

## Notes

- `workflow.json` is the repo-owned source of truth for workflow state.
- The extension persists the currently selected change and active task in session metadata so the workflow can survive resumes.
- This is the Phase 1 MVP for the app-factory workflow: it focuses on intake, artifact generation, approval, and task-by-task execution scaffolding.
