import { execSync } from "node:child_process";
import { join } from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseCommitSha: string;
}

export class WorktreeManager {
  private readonly worktreesDir: string;

  constructor(private readonly repoRoot: string) {
    this.worktreesDir = join(repoRoot, ".worktrees");
  }

  create(taskId: string, branch: string, baseBranch: string): WorktreeInfo {
    const path = join(this.worktreesDir, taskId);
    const opts = { cwd: this.repoRoot, stdio: "pipe" as const };

    // Capture base commit SHA before any agent work
    const shaRaw = execSync(`git rev-parse ${baseBranch}`, opts);
    const baseCommitSha = shaRaw.toString().trim();

    // Create isolated worktree on a new branch
    execSync(`git worktree add -b ${branch} ${path} ${baseBranch}`, opts);
    // No npm install needed — monorepo hoists node_modules to root

    return { path, branch, baseCommitSha };
  }

  reset(worktreePath: string, baseCommitSha: string): void {
    const opts = { cwd: worktreePath, stdio: "pipe" as const };
    execSync(`git reset --hard ${baseCommitSha}`, opts);
    try {
      execSync("git push --force-with-lease", opts);
    } catch {
      // Branch may not be pushed yet — ignore
    }
  }

  remove(worktreePath: string): void {
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd: this.repoRoot,
      stdio: "pipe",
    });
  }
}
