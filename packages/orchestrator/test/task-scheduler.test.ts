import { describe, expect, it } from "vitest";
import { TaskScheduler } from "../src/task-scheduler.js";
import type { ParsedTask } from "../src/types.js";

function makeTask(id: string, dependsOn: string[] = []): ParsedTask {
  return { id, title: id, model: "claude-opus-4-6", maxRetries: 3, requiresScreenshots: false, dependsOn, description: "Do it" };
}

describe("TaskScheduler", () => {
  it("runs independent tasks concurrently", async () => {
    const order: string[] = [];
    const scheduler = new TaskScheduler(3);

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    await scheduler.run(tasks, async (task) => {
      order.push(task.id);
    });

    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
  });

  it("respects depends-on ordering", async () => {
    const completedAt: Record<string, number> = {};
    const scheduler = new TaskScheduler(3);

    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]),
    ];

    await scheduler.run(tasks, async (task) => {
      await new Promise((r) => setTimeout(r, 10));
      completedAt[task.id] = Date.now();
    });

    expect(completedAt["a"]).toBeLessThan(completedAt["b"]);
  });

  it("respects max concurrency", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const scheduler = new TaskScheduler(2);

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c"), makeTask("d")];
    await scheduler.run(tasks, async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
