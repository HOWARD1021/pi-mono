# EvalLoop — Architecture & Usage Guide

**Status:** Implemented (2026-04-06)
**Implemented in:** `packages/orchestrator/src/eval-loop.ts`

---

## 一句話定義

> EvalLoop 是 Pi Orchestrator 的「爬山模式」——每次 generation 都產生程式碼並打分，
> 只保留進步的版本，持續循環直到達標。

---

## 與舊 retry loop 的差別

| | retry loop（舊） | EvalLoop（新） |
|---|---|---|
| 終止條件 | 最多 N 次就停 | score >= target 或跑完 maxGenerations |
| 評分 | pass / fail（二元） | 連續數字（0–100） |
| 失敗後 | 帶錯誤訊息重試 | 帶 score history 重試（讓 AI 知道分差） |
| 最佳版本 | 不追蹤 | 永遠從最高分的 commit 繼續出發 |

---

## 核心架構

```
orchestrate(spec.md)
  └─ spec.eval 存在？
       ├─ YES → runEvalSpec(spec, branch)
       │          └─ EvalLoop.run(task, ...)
       │               loop gen = 1..maxGenerations:
       │                 buildPrompt(task, scoreHistory)   ← 帶歷史分數
       │                 AgentRunner.run()                 ← spawn claude -p
       │                 EvalRunner.run(worktreePath)      ← 打分
       │                 score > best? → 留下 commit
       │                 score <= best? → git reset (丟掉)
       │                 score >= target? → break
       │
       └─ NO → runTaskWithRetry() (舊流程)
```

---

## `claude -p` 是什麼？為什麼用它？

### `-p` = `--print` = 非互動模式

```bash
# 你平常互動的方式（開 TUI）
claude

# orchestrator 用的方式（programmatic，當成 subprocess）
claude -p "寫一個函數計算費波那契數列" --model claude-opus-4-6 --dangerously-skip-permissions
```

當 orchestrator 呼叫 `AgentRunner.run()`，它實際上做的是：

```typescript
spawn("claude", ["-p", prompt, "--model", model, "--dangerously-skip-permissions"])
```

這會啟動一個**完全獨立的 claude process**，在 worktree 目錄裡：
- 讀 prompt
- 自主寫程式碼、修改檔案、執行命令
- 最後輸出 `<ready-for-review/>` 訊號
- 退出

**你現在用的 claude session 和 agent 用的 claude -p 是兩個不同的 process。**

### Copilot CLI 也支援

`runner:` 欄位控制要用哪個後端：

```yaml
runner: claude    # → spawn("claude", ["-p", ...])
runner: copilot   # → spawn("copilot", ["-p", "--yolo", "--autopilot", ...])
```

EvalLoop 本身不在乎 runner — 它只看 score。

---

## 兩種 Evaluator

### Track A — 可量化（直接比數字）

```
spawn agent → agent 改程式碼 → CodeEvalRunner 跑 bun test --coverage → score = 83.31
```

目前實作：`CodeEvalRunner` (in `eval-runner.ts`)
- 指令：`bun run test --coverage 2>&1`
- Parse：`/All files\s*\|\s*([\d.]+)/`
- 輸出：`{ score: 83.31, details: "Coverage: 83.31%..." }`

其他可以接的 Track A evaluator：

| 領域 | 指令 | parse 什麼 |
|------|------|-----------|
| 執行速度 | `hyperfine 'node solution.js'` | ms |
| Sharpe ratio | `python backtest.py` | JSON `{"sharpe": 1.23}` |
| Bundle size | `du -sk dist/` | KB |

### Track B — LLM-as-judge（SkillEvalRunner，尚未完整實作）

```
spawn agent → agent 改 prompt/文件 → SkillEvalRunner 呼叫 claude judge → weighted score = 7.2/10
```

Rubric 範例（Skill 品質）：
```
Clarity:           weight 0.25
Completeness:      weight 0.30
Testability:       weight 0.20
Non-functional:    weight 0.15
Technical:         weight 0.10

weighted_sum = Σ(score_i × weight_i)
quality_score = round(1 + 9 × normalized)  → 1–10
```

---

## Spec 格式

### 最小範例

```yaml
---
feature: Improve orchestrator test coverage
eval:
  type: track-a
  runner: code-coverage
  target: 85
  max-generations: 3
tasks:
  - id: task-coverage
    title: Add missing unit tests
    model: claude-opus-4-6
    runner: claude       # ← 控制用哪個 agent CLI
---

## task-coverage

Write tests that improve coverage above 85%.
```

### `eval:` 欄位參考

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `type` | `track-a \| track-b \| hybrid` | ✓ | evaluator 種類 |
| `runner` | string | ✓ | `code-coverage`, `skill-judge`, ... |
| `target` | number | ✓ | 達到這個分數就停止 |
| `max-generations` | number | — | 最多跑幾代（default: 20） |
| `time-budget-ms` | number | — | 或跑這麼久就停（尚未實作） |

---

## Score History — 注入 prompt 的格式

每一代 generation，AI 收到的 prompt 尾端都會附上：

```
## Score History

Best so far: 83.31 / 100 (generation 1)
Last attempt: 81.2 / 100 — dropped

Generation history:
  gen 1: 83.31 → keep
  gen 2: 81.2 → discard

Your goal: beat 83.31.
What specifically could you change to improve the score?
```

這讓 AI 每次都知道：
1. 目前最高分是多少、哪一代達到的
2. 上次嘗試失敗了還是成功了
3. 要超越哪個具體數字

---

## ScoreRegistry — 持久化

每次 generation 的結果都寫到 `.clawdbot/scores.json`：

```json
{
  "task-coverage": {
    "taskId": "task-coverage",
    "bestScore": 86.2,
    "bestCommitSha": "abc1234",
    "entries": [
      { "generation": 1, "score": 83.31, "commitSha": "sha1", "kept": true },
      { "generation": 2, "score": 81.2,  "commitSha": "sha2", "kept": false },
      { "generation": 3, "score": 86.2,  "commitSha": "abc1234", "kept": true }
    ]
  }
}
```

---

## 如何執行

```bash
# 目前狀態確認
cd /Users/howard/learn-claude-agents/packages/orchestrator
bun run test          # 75 pass

# 手動確認 baseline 分數
bun -e "
import { CodeEvalRunner } from './src/eval-runner.js';
console.log(new CodeEvalRunner().run(process.cwd()).score);
"
# → 83.31

# 跑 EvalLoop（會真的 spawn claude -p agent）
bun /Users/howard/learn-claude-agents/packages/orchestrator/orchestrate.ts \
  /tmp/eval-coverage.spec.md
```

---

## 新增的檔案一覽

| 檔案 | 說明 |
|------|------|
| `src/types.ts` | `EvalResult`, `ScoreEntry`, `ScoreHistory`, `EvalSpec` 型別 |
| `src/eval-runner.ts` | `EvalRunner` interface + `CodeEvalRunner` (Track A) + `SkillEvalRunner` stub |
| `src/score-registry.ts` | 分數歷史持久化（`.clawdbot/scores.json`） |
| `src/eval-loop.ts` | 主控制迴圈：generate → eval → keep/discard → repeat |
| `src/spec-parser.ts` | 新增 `eval:` YAML 解析 |
| `src/index.ts` | `runEvalSpec()` + orchestrate 路由 |
| `src/prompt-builder.ts` | 新增 `scoreHistory?` 參數，注入 Score History section |
| `test/eval-runner.test.ts` | 4 tests |
| `test/score-registry.test.ts` | 6 tests |
| `test/eval-loop.test.ts` | 5 tests |

---

## 未解決問題（來自 handoff）

1. **Track B 穩定性** — LLM judge 溫度問題，需要 `temperature=0` + 多次取平均
2. **time-budget-ms** — 欄位已解析，但 EvalLoop 尚未實作時間中止
3. **多 task** — 目前 `runEvalSpec` 只跑第一個 task，multi-task eval 待設計
4. **FinancialEvalRunner** — backtest library 待選（backtrader / vectorbt）
