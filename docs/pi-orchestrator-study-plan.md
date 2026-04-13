# Pi Orchestrator — 教學計劃

## 學習目標

讀完這個計劃後，你能夠：
1. 解釋 orchestrator 的完整執行流程
2. 自己寫一份 spec.md 讓系統執行
3. 看懂任何一個 src/*.ts 檔案在做什麼
4. 知道出問題時要從哪裡下手 debug

---

## 學習路徑（共 5 個 session）

---

### Session 1 — 先跑起來再說（30 分鐘）

**目標：** 看到系統動起來，對流程有感覺

**步驟：**
```bash
# 1. 看 spec 長什麼樣子
cat test-copilot-runner.spec.md

# 2. 看 task 狀態記錄
cat .clawdbot/active-tasks.json

# 3. 清除狀態、重跑 E2E
rm -f .clawdbot/active-tasks.json
bun packages/orchestrator/orchestrate.ts test-copilot-runner.spec.md

# 4. 跑完之後看狀態有什麼變化
cat .clawdbot/active-tasks.json
```

**看懂這些輸出：**
- `[Orchestrator] Tasks: ...` — 讀到幾個 task
- `[task-xxx] Attempt 1/2` — 第幾次嘗試
- `[agent] ...` — AI 的 streaming output
- `[agent] <ready-for-review/>` — AI 說做完了
- `[CI] No cloud checks — skipping` — cloud CI 沒有設定，跳過
- `[Notifier] PR Ready` — 最終通知

**問自己：** 如果 AI 沒印出 `<ready-for-review/>`，系統會怎麼處理？

---

### Session 2 — 讀懂資料結構（45 分鐘）

**目標：** 知道系統在傳什麼資料

**讀這兩個檔案（共 ~150 行）：**
```
packages/orchestrator/src/types.ts      — 所有 interface 定義
packages/orchestrator/src/spec-parser.ts — spec.md → ParsedSpec
```

**重點 interface：**

```typescript
ParsedTask       // 一個 task 的設定（id, title, model, runner, maxRetries...）
TaskRecord       // task 的執行狀態（status, attempts, attemptHistory, pr...）
FailureContext   // 一次失敗的記憶（approach, summary, failedTests）
AgentResult      // AI 跑完的結果（lastCommitSha）
ReviewResult     // review 結果（passed, criticalIssues[]）
TaskRunResult    // runTaskWithRetry 的回傳值（success, prNumber, attemptHistory）
```

**練習：** 在 `active-tasks.json` 裡找出每個 `TaskRecord` 欄位的值，對應到 types.ts。

---

### Session 3 — 核心迴圈（60 分鐘）

**目標：** 完全讀懂一次 task attempt 的流程

**讀這個檔案（216 行）：**
```
packages/orchestrator/src/index.ts
```

**用流程圖理解：**
```
runTaskWithRetry()
  │
  ├─ worktreeManager.create()     → 建立隔離的 git 環境
  ├─ buildPrompt()                → 組出給 AI 的指令
  ├─ agentRunner.run()            → 呼叫 AI，等 <ready-for-review/>
  │    └─ 驗 SHA 有沒有變 (Gap A)
  ├─ createOrUpdatePR()           → git push + gh pr create
  ├─ ciRunner.runLocal()          → bun run test
  ├─ ciRunner.runCloud()          → gh pr checks --watch
  ├─ reviewOrchestrator.review()  → 4 個 reviewer
  └─ 成功 → return { success: true }
       失敗 → 記錄 attemptHistory → reset worktree → 進下一次 attempt
```

**Gap C 的位置：** `orchestrate()` 函數最上面，`scheduler.run()` 之前

**問自己：**
- `worktreeManager.reset()` 是在什麼時候被呼叫的？
- `attemptHistory` 是怎麼從一次 attempt 傳到下一次的？

---

### Session 4 — AI 那一層（45 分鐘）

**目標：** 知道 orchestrator 怎麼跟 AI 說話

**讀這兩個檔案（共 ~130 行）：**
```
packages/orchestrator/src/agent-runner.ts   — spawn AI, 偵測信號
packages/orchestrator/src/prompt-builder.ts — 組 prompt
```

**agent-runner.ts 的關鍵邏輯：**
```typescript
// 1. 根據 runner 決定要跑哪個 CLI
const args = this.buildSpawnArgs(prompt, model)  // claude -p 或 copilot -p ...

// 2. spawn subprocess，把 stdout pipe 回來
// 3. 每個 chunk 累加到 fullOutput（不是看單個 chunk）
// 4. fullOutput.includes("<ready-for-review/>") → resolve
// 5. process exit 但沒有信號 → reject（附上 last output）
// 6. 驗 SHA：getHeadSha() 現在 vs baseSha → 不同才算真的有 commit
```

**prompt-builder.ts 的順序（很重要）：**
```
1. git history      ← AI 要知道自己之前做了什麼
2. context files    ← 參考文件
3. attempt history  ← 之前失敗的教訓（Gap B）
4. task 描述        ← 這次要做什麼
5. Completion Gate  ← 怎麼結束（跑測試、commit、印信號）
6. MANDATORY FINAL OUTPUT ← 強調信號（gpt-5-mini 用）
```

**問自己：**
- 為什麼要用 `fullOutput` 而不是直接看每個 streaming chunk？
- 如果 AI commit 了但 SHA 沒變，代表什麼？

---

### Session 5 — 其他元件 + 自己寫 spec（45 分鐘）

**目標：** 讀懂其餘小元件，然後自己寫一個 spec 跑看看

**快速瀏覽（每個 10 分鐘）：**

```
src/failure-extractor.ts   — 問 Claude「這個 error 的 approach 是什麼？」
src/review-orchestrator.ts — 4 個 reviewer Promise.allSettled
src/worktree-manager.ts    — git worktree add / remove / reset
src/task-registry.ts       — JSON 檔案讀寫，狀態持久化
src/task-scheduler.ts      — concurrency 3 的 task queue
```

**自己寫一個 spec（實作練習）：**

在 repo root 建立 `my-first.spec.md`：
```yaml
---
feature: My First Spec
context: []
tasks:
  - id: task-hello-claude
    title: "Add hello_claude.py to repo root"
    model: claude-haiku-4-5-20251001
    runner: claude
    max-retries: 2
    depends-on: []
---

## task-hello-claude

Create `/hello_claude.py` with this content:

```python
def hello() -> str:
    return "hello from claude"
```

Do NOT modify any other files.
```

跑起來：
```bash
rm -f .clawdbot/active-tasks.json
bun packages/orchestrator/orchestrate.ts my-first.spec.md
```

---

## 快速參考

### 出問題時看哪裡

| 症狀 | 看哪裡 |
|------|--------|
| AI 沒有印出信號 | `src/agent-runner.ts` fullOutput 邏輯 |
| prompt 內容不對 | `src/prompt-builder.ts` |
| CI 一直 fail | `src/ci-runner.ts` + `gh pr checks` 輸出 |
| task 卡在 running | `src/index.ts` Gap C 邏輯 / `.clawdbot/active-tasks.json` |
| reviewer 擋住 PR | `src/review-orchestrator.ts` |
| worktree 殘留 | `git worktree list` / `src/worktree-manager.ts` |

### 常用指令

```bash
# 看 task 狀態
cat .clawdbot/active-tasks.json | python3 -m json.tool

# 清除狀態重跑
rm -f .clawdbot/active-tasks.json

# 清除殘留 worktree
git worktree list
git worktree remove .worktrees/<name> --force

# 清除殘留 branch
git branch | grep agent/ | xargs git branch -D

# 跑測試
cd packages/orchestrator && bun run test
```
