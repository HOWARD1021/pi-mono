# Pi Orchestrator — Handoff v7 (學習紀錄)

**Date:** 2026-04-06
**Session type:** 讀 code 學習（非開發）
**Reference docs:**
- `docs/pi-orchestrator-study-plan.md` — 5 session 學習路徑
- `docs/pi-orchestrator-overview.md` — 架構全覽

---

## 今天讀了什麼

### 已讀完

| 檔案 | 關鍵洞察 |
|------|----------|
| `types.ts` | `ParsedTask`（藍圖）vs `TaskRecord`（日誌）是最重要的區分 |
| `spec-parser.ts` | YAML → Zod 驗證 → camelCase → 絕對路徑，fail-fast 在解析時就驗 depends-on |
| `agent-runner.ts` | 用 `fullOutput` 累加偵測信號；信號出現就主動 kill process（不等 exit）；Gap A = 驗 SHA |

### spec-parser.ts 三個關鍵轉換

1. **YAML 字串 → TypeScript object**：`yaml.parse` + Zod `safeParse`（含 default 值注入）
2. **kebab-case → camelCase**：`max-retries` → `maxRetries`（行 103–114 手動 map）
3. **相對路徑 → 絕對路徑**：`resolve(specDir, p)`（行 129）

### agent-runner.ts vs Inference.ts

| | `agent-runner.ts` | `Inference.ts`（PAI tool）|
|---|---|---|
| 結束條件 | 偵測 `<ready-for-review/>` 主動 kill | 等 process exit |
| tools | `--dangerously-skip-permissions` 全開 | `--tools ''` 關掉 |
| SHA 驗證 | 有（Gap A）| 無 |
| 適合場景 | AI 在 repo 工作（寫 code、commit）| 問 Claude 一個問題 |

**為什麼用 `fullOutput` 不看單個 chunk：** 信號 `<ready-for-review/>` 可能被切成兩個 chunk 傳來，累加後才能可靠偵測。

---

## 還沒讀的（按建議順序）

- [ ] `worktree-manager.ts` — git worktree 隔離機制
- [ ] `prompt-builder.ts` — 組 prompt 順序（含 Gap B 記憶注入）
- [ ] `ci-runner.ts` — local + cloud CI（要讓 orchestrator 跑新 repo 需改這裡）
- [ ] `review-orchestrator.ts` — 4 reviewer `Promise.allSettled`（Gap D）
- [ ] `task-registry.ts` — JSON 持久化
- [ ] `task-scheduler.ts` — concurrency 3 DAG 排程
- [ ] `index.ts` — 全部串起來 + Gap C 復原

## 未解問題（留給下次）

1. `worktree-manager.reset()` 什麼時候被呼叫？（retry 失敗時的 reset 流程）
2. `ci-runner.ts` 改哪幾行可以讓 orchestrator 跑 workout-app（`npm run test`）？
3. `task-scheduler.ts` 怎麼實作 concurrency 上限 3 + 等 depends-on？

## 下次開始的方式

```bash
cd /Users/howard/learn-claude-agents
# 繼續按順序讀
cat packages/orchestrator/src/worktree-manager.ts
```

---

# Pi Orchestrator — Handoff v6

**Date:** 2026-04-06

---

## 本次學習紀錄（2026-04-06）

### 跑起來了

```bash
bun packages/orchestrator/orchestrate.ts examples/hello-eval.spec.md
# Gen 1: 93.44 → 超過 target 85 → 直接完成
```

### 執行路徑對照（完整 trace）

```
orchestrate()           index.ts:37
  → parseSpec()         有 eval block → 走 EvalLoop 路徑
  → runEvalSpec()       index.ts:22
      → CodeEvalRunner  eval-runner 選擇器 (runner: "code-coverage")
      → EvalLoop.run()  eval-loop.ts:30
          → WorktreeManager.create()      建 .worktrees/task-hello-eval，記 baseCommitSha
          → for gen in 1..maxGenerations:
              → buildPrompt()             task description + <ready-for-review/> gate
              → AgentRunner.run()         spawn claude -p --dangerously-skip-permissions
                  stdout 監聽 → 偵測信號 → getHeadSha() → Gap A 驗證
              → CodeEvalRunner.run()      bun test --coverage → regex /All files\s*\|\s*([\d.]+)/
              → if score > bestScore: keep
                else: worktreeManager.reset() 回 baseCommitSha
              → if score >= target: break
```

### 分數怎麼算

`eval-runner.ts:21-31`：跑 `bun run test --coverage`，parse `All files | 93.44 | ...` 那行。
**分數 = statement coverage %，不是 AI 評分。**

### 為什麼看不到 agent 在幹嘛

`claude -p` 的 tool call（讀檔、寫檔、bash）靜默執行，只有 model 的文字輸出才進 stdout。

**修復（本次）：** `agent-runner.ts` 加了 `--verbose`，現在看得到每個 tool call。

### AgentRunner vs Inference.ts

| | AgentRunner | Inference.ts |
|---|---|---|
| 用途 | 讓 Claude 在 repo 工作 | 問 Claude 一個問題 |
| tools | 全開 | `--tools ''`（停用） |
| 等待 | 信號 `<ready-for-review/>` | process close |
| timeout | 30 分鐘 | 15–90 秒 |

`FailureExtractor` 已經在做 inference（`execSync claude -p --model haiku`），它是 Inference.ts 的 inline 版本，功能等價。

### .clawdbot/active-tasks.json 狀態規則

- `done` / `failed` → orchestrator 不會動它
- `running` → Gap C 觸發：帶 attemptHistory 重入
- 同一 task ID 要重跑 → 刪檔或手動改 `"pending"`
- 新 spec（新 task ID）→ 不需要刪

### 本次 code 異動

| 檔案 | 改動 |
|------|------|
| `packages/orchestrator/src/agent-runner.ts` | claude spawn args 加 `--verbose` |

---

# Pi Orchestrator — Handoff v5

**Date:** 2026-04-04
**Repo:** `learn-claude-agents` — branch `learn-claude-agents`
**Working dir:** `/Users/howard/learn-claude-agents`

---

## What Was Done (This Session)

### Signal Compliance Fix (`prompt-builder.ts`)

Added a `## ⚠️ MANDATORY FINAL OUTPUT` section at the very end of the prompt, making it impossible for weak models (gpt-5-mini) to miss the signal requirement.

### Gap C — Restart Recovery (`index.ts`)

On startup, `orchestrate()` now calls `registry.getRunning()` and re-enters any orphaned `"running"` tasks:
- Matches orphaned record to spec task by ID
- Re-runs `runTaskWithRetry` with preserved `attemptHistory`
- Tasks not found in spec are marked `"failed"`

`runTaskWithRetry` gains an optional `initialAttemptHistory?: string[]` parameter for seeding retry context on recovery.

### Gap D — 4-Reviewer Parallel (`review-orchestrator.ts`)

All 4 CLIs now run in `Promise.allSettled`:
| Reviewer | CLI |
|----------|-----|
| Claude   | `claude -p ... --model claude-haiku-4-5-20251001` |
| Gemini   | `gemini -p ...` |
| Copilot  | `copilot -p ... --yolo --no-ask-user -s` |
| Codex    | `codex exec ...` |

Degrade gracefully: if a reviewer CLI throws, skip it. All issues are prefixed `[ReviewerName]`.

---

## Files Changed This Session

| File | Change |
|------|--------|
| `packages/orchestrator/src/prompt-builder.ts` | Added `## ⚠️ MANDATORY FINAL OUTPUT` section |
| `packages/orchestrator/src/index.ts` | Gap C recovery loop in `orchestrate()`; `initialAttemptHistory` param on `runTaskWithRetry` |
| `packages/orchestrator/src/review-orchestrator.ts` | 4-reviewer `Promise.allSettled` (Gap D) |
| `packages/orchestrator/test/prompt-builder.test.ts` | New test: mandatory section appears after gate |
| `packages/orchestrator/test/index.test.ts` | New test: Gap C seed history; `runner` field on mockTask |
| `packages/orchestrator/test/review-orchestrator.test.ts` | 5 tests covering all 4 reviewers + graceful degradation |

**Test status:** 50 pass, 1 skipped

---

## How to Start the Next Session

```bash
cd /Users/howard/learn-claude-agents
claude .

# Verify state
git log --oneline -8
cd packages/orchestrator && bun run test   # 50 pass
```

---

## E2E Status (Copilot Runner Smoke Test)

Spec: `test-copilot-runner.spec.md` — task: create `hello_copilot.py`

| Step | Status | Notes |
|------|--------|-------|
| Worktree create | ✅ | |
| `copilot --autopilot` spawned | ✅ | |
| Signal `<ready-for-review/>` detected | ✅ | After `fullOutput` fix |
| SHA verification (Gap A) | ✅ | |
| PR creation `--base learn-claude-agents` | ✅ | |
| Cloud CI | ✅ | |
| **gpt-5-mini signal compliance** | ⚠️ | Fixed in prompt (untested) — needs a new E2E run to confirm |

**To run smoke test:**
```bash
rm -f .clawdbot/active-tasks.json
bun packages/orchestrator/orchestrate.ts test-copilot-runner.spec.md
```

---

## V2 Gaps — All Complete

| Gap | Status | Description |
|-----|--------|-------------|
| **A** — Post-signal verification | ✅ | SHA must change after signal |
| **B** — Rich failure memory | ✅ | Approach + root cause injected into retry prompt |
| **C** — Restart recovery | ✅ | Orphaned `running` tasks re-entered at startup |
| **D** — 4-reviewer parallel | ✅ | All 4 CLI tools, `Promise.allSettled`, graceful skip |

---

## Architecture Quick Reference

```
orchestrate(spec.md)
  ├─ Gap C: getRunning() → re-enter orphaned tasks
  └─ TaskScheduler.run(tasks)
       └─ runTaskWithRetry(task, contextFiles, baseBranch, registry, initialAttemptHistory?)
            ├─ WorktreeManager.create()          → git worktree add; records baseCommitSha
            ├─ buildPrompt()                     → git history + context + attempts + task + gate + MANDATORY FINAL OUTPUT
            ├─ AgentRunner.run(prompt, baseSha)  → claude OR copilot subprocess
            │    └─ watches fullOutput for <ready-for-review/>
            │    └─ verifies SHA changed (Gap A)
            ├─ createOrUpdatePR(baseBranch)      → git push + gh pr create --base baseBranch
            ├─ CIRunner.runLocal()               → bun run test in packages/orchestrator/
            ├─ CIRunner.runCloud(branch)         → gh pr checks "branch" --watch
            ├─ ReviewOrchestrator.review()       → 4 reviewers in Promise.allSettled (Gap D)
            └─ Notifier.notifyReady()            → Telegram or console.log
```

## Key Files

| File | Purpose |
|------|---------|
| `test-copilot-runner.spec.md` | Smoke test spec (copilot runner) |
| `packages/orchestrator/orchestrate.ts` | CLI entry: `bun packages/orchestrator/orchestrate.ts <spec>` |
| `packages/orchestrator/src/index.ts` | Core loop + Gap C recovery |
| `packages/orchestrator/src/agent-runner.ts` | Spawns agent, detects signal, verifies SHA |
| `packages/orchestrator/src/ci-runner.ts` | Local + cloud CI |
| `packages/orchestrator/src/prompt-builder.ts` | Prompt construction + mandatory signal section |
| `packages/orchestrator/src/review-orchestrator.ts` | 4-reviewer parallel review |
| `packages/orchestrator/src/failure-extractor.ts` | Retry context extraction |
| `.clawdbot/active-tasks.json` | Task state (delete to reset between runs) |
