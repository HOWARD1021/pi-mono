import type { ParsedTask } from "./types.js";

export class TaskScheduler {
  constructor(private readonly maxConcurrent = 3) {}

  async run(
    tasks: ParsedTask[],
    execute: (task: ParsedTask) => Promise<void>
  ): Promise<void> {
    const completed = new Set<string>();
    const running = new Map<string, Promise<void>>();
    const remaining = [...tasks];

    while (remaining.length > 0 || running.size > 0) {
      for (let i = remaining.length - 1; i >= 0; i--) {
        const task = remaining[i];
        const depsmet = task.dependsOn.every((dep) => completed.has(dep));
        if (depsmet && running.size < this.maxConcurrent) {
          remaining.splice(i, 1);
          const p = execute(task).then(() => {
            completed.add(task.id);
            running.delete(task.id);
          });
          running.set(task.id, p);
        }
      }

      if (running.size === 0 && remaining.length > 0) {
        throw new Error("Deadlock: remaining tasks have unresolvable dependencies");
      }

      if (running.size > 0) {
        await Promise.race(running.values());
      }
    }
  }
}
