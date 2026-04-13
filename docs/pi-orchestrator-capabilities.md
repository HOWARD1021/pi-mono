# Pi Orchestrator — 目前能力總覽

**更新：** 2026-04-06
**Branch:** `learn-claude-agents`

---

## 一句話說明

> Pi Orchestrator 把 markdown spec 變成 AI 自動送 PR 的系統，內建失敗記憶、模型升級、crash 恢復、4 個 reviewer 把關，也可以跑 EvalLoop 讓 AI 自己迭代優化直到達標。

---

## 三種跑法

```
spec.md (沒有 eval:)  →  runTaskWithRetry  →  PR + CI + Review
spec.md (有 eval:)    →  EvalLoop           →  迭代拿分直到 target
crash 後重啟          →  Gap C recovery     →  孤兒 task 接著跑
```

---

## 能力清單

### Spec 層

| 能力 | 說明 |
|------|------|
| 解析 YAML frontmatter | `feature`, `tasks`, `context`, `eval` |
| Task 依賴圖 | `depends-on` → TaskScheduler 控制執行順序 |
| 平行執行 | 最多 3 task 同時跑，依賴滿足才啟動 |
| Fallback 升級 | `fallback-model` / `fallback-runner`：失敗就換聰明模型 |

### Agent 層

| 能力 | 說明 |
|------|------|
| `runner: claude` | `claude -p` subprocess |
| `runner: copilot` | `copilot --autopilot --yolo` subprocess |
| 任意 model | `gpt-5-mini` / `claude-sonnet-4-6` / `claude-opus-4-6`… |
| 信號偵測 | stdout 出現 `<ready-for-review/>` 才算完成 |
| SHA 驗證 (Gap A) | 信號出現後必須有新 commit，沒有 → 重試 |

### Git 層

| 能力 | 說明 |
|------|------|
| Worktree 隔離 | 每個 task 有獨立目錄，互不干擾 |
| Auto PR | `git push` → `gh pr create --base <branch>` |
| Retry reset | 失敗後 `git reset --hard` 回 base SHA 重來 |

### 驗證層

| Gate | 實作 |
|------|------|
| Local CI | `bun run test` in worktree |
| Cloud CI | `gh pr checks --watch` |
| 4 個 AI Reviewer | Claude + Gemini + Copilot + Codex 平行；任一 CRITICAL → fail |
| Failure 記憶 (Gap B) | CI 失敗後用 Claude 解析錯誤 → approach + root cause 注入下一次 prompt |

### 恢復層

| 能力 | 說明 |
|------|------|
| Crash recovery (Gap C) | 重啟後讀 `.clawdbot/active-tasks.json`，孤兒 task 接著跑 |
| 通知 | Telegram token 有 → Telegram；沒有 → console.log |

### EvalLoop (`eval:` spec)

| 能力 | 說明 |
|------|------|
| 迭代跑 | AI 改 code → 自動評分 → 只保留進步的版本 |
| 目標停止 | `target: 85` → 分數達標就停 |
| 世代上限 | `max-generations: 3` → 不超過 N 輪 |
| 分數紀錄 | ScoreRegistry 記每一代，注入 prompt 讓 AI 知道目前最佳分數 |
| 目前支援的 runner | `code-coverage`（跑測試拿 coverage %） |

---

## 已知限制

| 限制 | 現況 |
|------|------|
| gpt-5-mini 弱 | 有 prompt fix + fallback 升級緩解，仍可能失敗 |
| Cloud CI 延遲 | GitHub Actions 沒 trigger 時直接 skip，不等 |
| Reviewer CLI 需本機安裝 | Gemini/Codex 沒裝會 graceful skip，不算失敗 |
| Worktree 殘留 | 跑失敗後 `.worktrees/` 不自動清理 |
| Agent runner 只有兩種 | claude + copilot；gemini / codex 只有 reviewer 角色 |
| PR comment | 4 個 reviewer 結果只影響 pass/fail，不寫進 PR |

---

## 完整執行流程

```
orchestrate(spec.md)
  ├─ Gap C: getRunning() → 孤兒 task 重新執行
  └─ TaskScheduler.run(tasks, concurrency=3)
       └─ runTaskWithRetry(task)
            ├─ WorktreeManager.create()       → git worktree add; 記錄 baseCommitSha
            ├─ buildPrompt()                  → context + 失敗記憶 + task + 強制信號指令
            ├─ 決定本次 model/runner           → attempt=1 用主模型; attempt>1 用 fallback
            ├─ AgentRunner.run(prompt, model) → claude 或 copilot subprocess
            │    ├─ 偵測 <ready-for-review/>
            │    └─ 驗證 SHA 有變（Gap A）
            ├─ createOrUpdatePR()             → git push + gh pr create
            ├─ CIRunner.runLocal()            → bun run test
            ├─ CIRunner.runCloud()            → gh pr checks --watch
            ├─ ReviewOrchestrator.review()    → 4 reviewers Promise.allSettled（Gap D）
            └─ Notifier.notifyReady()         → Telegram 或 console
```

---

## 如何確認系統健康

```bash
# 1. 跑單元測試
cd packages/orchestrator && bun run test
# 預期：81 pass, 1 skipped

# 2. 確認沒有孤兒 worktree
git worktree list
# 預期：只有 main worktree

# 3. 確認沒有殘留 agent branch
git branch | grep agent/
# 預期：空

# 4. E2E smoke test（會跑真的 AI，消耗額度）
rm -f .clawdbot/active-tasks.json
bun packages/orchestrator/orchestrate.ts examples/client-demo.spec.md
```

---

## 可用的 Spec 範例

| Spec | 說明 | 模式 |
|------|------|------|
| `examples/client-demo.spec.md` | 3 個 agent 協作：建 word-freq lib → 寫測試 → 優化 | runTaskWithRetry |
| `examples/copilot-smoke.spec.md` | 最小化 copilot runner 冒煙測試 | runTaskWithRetry |
| `examples/hello-eval.spec.md` | EvalLoop hello world：AI 迭代提升 coverage 到 85% | EvalLoop |

---

## V3 候選功能（尚未實作）

| 功能 | 說明 |
|------|------|
| Dry-run 模式 | `--dry-run`：印 prompt 不跑 AI |
| PR comment | Reviewer 結果寫進 PR comment |
| Cloud CI 等待 | 等 GitHub Actions trigger 再 poll，而不是直接 skip |
| Gemini / Codex runner | 支援更多 agent runner |
| Worktree 自動清理 | 失敗後自動 `git worktree remove` |
| Spec 模板庫 | 常見任務的 spec 範本 |
