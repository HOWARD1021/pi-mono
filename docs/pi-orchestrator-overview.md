# Pi Orchestrator — 系統說明

## 這是什麼

Pi Orchestrator 是一個**自動化開發代理**：你給它一份 `spec.md`，它會自動叫 AI（Claude 或 Copilot）寫程式、跑測試、開 PR、做 Code Review，最後通知你 PR 已 ready。

你唯一要做的事：**寫好 spec。**

---

## 一次完整的執行流程

```
你                          Orchestrator                     GitHub
─────────────────────────────────────────────────────────────────
寫 spec.md ──────────────→ 解析 spec
                           建立 git worktree (隔離環境)
                           呼叫 AI agent (claude / copilot)
                               ↓ AI 寫 code、跑 test、commit
                           等待 <ready-for-review/> 信號
                           驗證 commit SHA 有變 (Gap A)
                           ──────────────────────────────→ git push
                           ──────────────────────────────→ gh pr create
                           跑 local CI (bun run test)
                           跑 cloud CI (gh pr checks)
                           4 個 reviewer 平行審查 (Gap D)
                           ──────────────────────────────→ Notifier
你 ←──── PR #N ready ──────
```

---

## 怎麼寫 spec.md

```yaml
---
feature: 功能名稱
context: []                    # 要餵給 AI 的參考文件路徑（可空）
tasks:
  - id: task-foo
    title: "做什麼事"
    model: gpt-5-mini          # 用哪個模型
    runner: copilot            # claude 或 copilot
    max-retries: 2             # 最多重試幾次
    depends-on: []             # 依賴哪個 task ID（可空）
---

## task-foo

（用 Markdown 描述這個 task 要做什麼）
```

---

## AI runner 選項

| runner | 底層 CLI | 免費？ | 適合場景 |
|--------|----------|--------|----------|
| `claude` | `claude -p --dangerously-skip-permissions` | 否 | 複雜任務、高品質輸出 |
| `copilot` | `copilot -p --yolo --autopilot --no-ask-user -s` | ✅ gpt-5-mini | 簡單任務、快速驗證 |

---

## 怎麼跑

```bash
# 清除上次狀態
rm -f .clawdbot/active-tasks.json

# 執行
bun packages/orchestrator/orchestrate.ts your-spec.md
```

---

## 重要機制

### Gap A — 防止 AI 說謊
AI 輸出 `<ready-for-review/>` 之後，orchestrator 會驗證 git commit SHA 有沒有真的改變。沒改變 → 直接 fail，不讓 AI 空手過關。

### Gap B — 重試記憶
每次 attempt 失敗，orchestrator 會記錄：
- AI 嘗試了什麼方法
- 失敗原因是什麼

下一次 retry 的 prompt 會包含這些歷史，避免 AI 重複同樣的錯誤。

### Gap C — 重啟復原
如果 orchestrator 中途 crash，下次啟動會偵測到 `status: "running"` 的孤兒 task，帶著既有的 attempt history 重新執行，不會從頭開始。

### Gap D — 4 個 reviewer 平行審查
Code Review 由 4 個 CLI 同時跑：

| Reviewer | 專注 |
|----------|------|
| Claude   | 正確性、邏輯 |
| Gemini   | 安全性 |
| Copilot  | edge cases |
| Codex    | 程式碼品質 |

任一 CLI 不存在或超時 → 跳過，不擋流程。只要找到 `CRITICAL:` 開頭的問題 → fail，進入下一次 retry。

---

## 核心程式碼位置

| 功能 | 檔案 |
|------|------|
| CLI 入口 | `packages/orchestrator/orchestrate.ts` |
| 主流程 + Gap C 復原 | `packages/orchestrator/src/index.ts` |
| AI agent 呼叫 + Gap A 驗證 | `packages/orchestrator/src/agent-runner.ts` |
| Prompt 建構 + 強制信號指令 | `packages/orchestrator/src/prompt-builder.ts` |
| Local + Cloud CI | `packages/orchestrator/src/ci-runner.ts` |
| 4-reviewer 審查 | `packages/orchestrator/src/review-orchestrator.ts` |
| 失敗記憶 (Gap B) | `packages/orchestrator/src/failure-extractor.ts` |
| Task 狀態持久化 | `packages/orchestrator/src/task-registry.ts` |
| git worktree 管理 | `packages/orchestrator/src/worktree-manager.ts` |
| Task 排程（concurrency 3） | `packages/orchestrator/src/task-scheduler.ts` |

---

## 狀態檔案

- `.clawdbot/active-tasks.json` — 記錄每個 task 的執行狀態
- 刪掉這個檔案 = 清除所有狀態，下次從頭開始
