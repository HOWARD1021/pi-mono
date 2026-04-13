---
feature: Fallback Model Feature
context: []
tasks:
  - id: task-1
    title: Build something
    model: gpt-5-mini
    runner: copilot
    fallback-model: claude-sonnet-4-6
    fallback-runner: claude
    max-retries: 2
    depends-on: []
---

## task-1

Do the work.
