# EvalLoop — Handoff v1

**Date:** 2026-04-05
**Status:** Design phase — not yet implemented
**Repo:** `learn-claude-agents` — branch `learn-claude-agents`

---

## What Is EvalLoop

Pi Orchestrator 現在的 loop 是：

```
generate → pass/fail → retry (最多 N 次)
```

EvalLoop 把它升級成：

```
generate → score (數字) → compare to best → keep or discard → loop forever
```

靈感來自 Karpathy 的 [autoresearch](https://github.com/karpathy/autoresearch)：
AI 修改 `train.py` → 跑 5 分鐘 → val_bpb 比上次好？→ keep → 重複

---

## 核心差異

| | Pi Orchestrator (現在) | EvalLoop (目標) |
|---|---|---|
| 終止條件 | maxRetries 次 | score >= threshold 或手動停止 |
| 評分 | pass / fail（二元） | 連續數字（0–10 或 0–100） |
| 記憶 | attempt history（失敗原因） | score registry（最佳分數 + 歷史曲線） |
| 模式 | 單次跑完就結束 | infinite loop（放著跑一整晚）|

---

## 兩種 Evaluator

### Track A — 可量化（直接比數字）

```
run evaluator → score = 1.23
score > best? → keep
score <= best? → discard
```

客觀、deterministic、快速。

| 領域 | Metric | 指令 |
|------|--------|------|
| 程式碼速度 | 執行時間 ms | `hyperfine 'node solution.js'` |
| 測試覆蓋率 | coverage % | `bun run test --coverage` |
| 量化交易 | Sharpe ratio | `python backtest.py → {"sharpe": 1.23}` |
| ML 模型 | val_loss | 跑幾個 epoch |

### Track B — 不可量化（LLM-as-judge）

```
LLM judge 讀 output + rubric → weighted score → 7/10
7 > best (6)? → keep
```

適合 prompt 品質、code readability、文件品質等無法直接量化的東西。

**Rubric 範例（Skill 品質）：**
```
Clarity:           weight 0.25
Completeness:      weight 0.30
Testability:       weight 0.20
Non-functional:    weight 0.15
Technical constraints: weight 0.10

weighted_sum = Σ(score_i × weight_i)
normalized   = weighted_sum / 5
quality_score = round(1 + 9 × normalized)  → 1–10
```

### 兩者疊加（hybrid）

```
pass/fail gate (必須全過，不計分)
    ↓
Track A score (coverage, speed)
    ↓
Track B score (LLM judge)
    ↓
combined = A × 0.6 + B × 0.4
    ↓
compare to best → keep or discard
```

---

## 三個目標領域

| 領域 | 主力 Track | 建議順序 | 依賴 |
|------|-----------|---------|------|
| **程式碼品質** | A + B | ① 先建 | 現在就能跑 |
| **Skill 優化** | B | ② 次之 | 需要 rubric 設計 |
| **量化交易** | A | ③ 最後 | 需要 backtest engine + 歷史資料 |

First Principles 結論：**三個領域共用同一個 loop，evaluator 是可替換的插件。**

---

## 架構設計（尚未實作）

```
EvalLoop
  ├─ EvalRunner (interface)
  │    ├─ CodeEvalRunner      → bun run test --coverage → { score, details }
  │    ├─ SkillEvalRunner     → claude judge rubric → { score, breakdown }
  │    └─ FinancialEvalRunner → python backtest.py → { sharpe, drawdown }
  │
  ├─ ScoreRegistry            → .clawdbot/scores.json
  │    ├─ best_score          → 目前最高分
  │    ├─ score_history[]     → 每次 generation 的分數曲線
  │    └─ best_commit_sha     → 最高分對應的 commit
  │
  └─ EvalLoop.run(spec, evaluator)
       loop:
         AI generate → eval → score
         score > best? → git commit + update registry
         score <= best? → git reset (discard)
         inject score context into next prompt
         repeat
```

### spec.md 新欄位（設計草稿）

```yaml
---
feature: Optimize coverage
eval:
  type: track-a            # track-a | track-b | hybrid
  runner: code-coverage    # 對應 EvalRunner 的實作
  target: 95               # 達到這個分數就停止
  time-budget: 60m         # 或跑這麼久就停止
  max-generations: 20      # 或最多跑幾次
tasks:
  - id: task-optimize
    ...
---
```

### Prompt 新增的 score context

每次 generation，prompt 尾端會附上：

```
## Score History

Best so far: 7.2 / 10 (generation 3)
Last attempt: 6.8 / 10 — dropped

Generation history:
  gen 1: 5.1 → discard
  gen 2: 6.3 → keep (new best)
  gen 3: 7.2 → keep (new best)
  gen 4: 6.8 → discard

Your goal: beat 7.2.
What specifically could you change to improve the score?
```

---

## 與現有架構的關係

### Pi Orchestrator 現在有的（可複用）

| 元件 | 複用方式 |
|------|---------|
| `AgentRunner` | 直接用，spawn claude / copilot |
| `WorktreeManager` | 直接用，keep/discard = reset worktree |
| `TaskRegistry` | 擴充成 ScoreRegistry |
| `buildPrompt()` | 加入 score history section |
| `FailureExtractor` | 可改成 ScoreExtractor（從 eval 結果提取改進方向）|

### 需要新建的

| 元件 | 說明 |
|------|------|
| `EvalRunner` interface | 定義 `run(worktreePath) → { score: number, details: string }` |
| `CodeEvalRunner` | 跑 `bun run test --coverage`，parse 出 coverage % |
| `SkillEvalRunner` | 呼叫 claude judge，套 rubric，算 weighted score |
| `ScoreRegistry` | 持久化 best score + history |
| `EvalLoop.run()` | 取代 `runTaskWithRetry` 的 infinite loop 版本 |

---

## 與 s09 的關係

**s09（Agent Team Mailboxes）= 橫向協作**
多個 agent 並行，互相傳訊息，分工完成任務

**EvalLoop = 縱向優化**
一個 agent 反覆改同一個東西，直到分數夠高

**未來可以結合：**
```
s09 team + EvalLoop:
  Lead 分配任務
    ├─ Coder agent 有自己的 EvalLoop（持續優化 code）
    └─ Reviewer agent 是 Track B evaluator（給 coder 打分）
```
這是真正的「多代理 autoresearch」，但先建 EvalLoop 再說。

---

## 如何開始下一個 session

```bash
cd /Users/howard/learn-claude-agents
claude .

# 目前狀態
git log --oneline -5
cd packages/orchestrator && bun run test   # 50 pass

# 讀這個 handoff
cat docs/evalloop-handoff.md
```

**第一步建議：** 建 `EvalRunner` interface + `CodeEvalRunner`，先讓 coverage % 能自動跑出來，接進現有的 `runTaskWithRetry`，驗證分數比較邏輯。

---

## 未解決的問題

1. **Track B 穩定性** — LLM judge 每次打分可能不同（溫度問題），需要 `temperature=0` + 多次取平均
2. **infinite loop 的停止條件** — target score 到了就停？還是 time budget？還是人工 Ctrl+C？
3. **score 的可比性** — generation 1 的 coverage 80% 和 generation 5 的 80% 在同一個 worktree 嗎？需要確保 baseline 一致
4. **FinancialEvalRunner** — 需要決定用哪個 backtest library（backtrader / vectorbt / zipline）
