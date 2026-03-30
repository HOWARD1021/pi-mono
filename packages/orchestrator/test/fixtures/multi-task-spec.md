---
feature: Multi Task Feature
context: []
tasks:
  - id: task-1
    title: Backend API
    model: claude-opus-4-6
    max-retries: 2
    requires-screenshots: false

  - id: task-2
    title: Frontend UI
    depends-on: [task-1]
    requires-screenshots: true
---

## task-1

Build the backend.

## task-2

Build the frontend.
