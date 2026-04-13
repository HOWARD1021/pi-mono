# Pi Orchestrator — 計劃書

## 現狀（已完成）

### V1 基礎功能
- [x] 解析 `spec.md`
- [x] 建立 git worktree 隔離環境
- [x] 呼叫 `claude -p` subprocess，偵測 `<ready-for-review/>` 信號
- [x] 建立 PR（`gh pr create`）
- [x] Local CI（`bun run test`）
- [x] Cloud CI（`gh pr checks --watch`）
- [x] Single reviewer（Claude）
- [x] Telegram / console 通知

### V2 強化（本次全部完成）
- [x] **Gap A** — 驗證 SHA 真的有變（防 AI 說謊）
- [x] **Gap B** — 失敗記憶：approach + root cause 注入 retry prompt
- [x] **Gap C** — crash 重啟復原（孤兒 task 重新執行）
- [x] **Gap D** — 4 個 reviewer 平行審查
- [x] **Copilot runner** — 支援 `runner: copilot`，使用 gpt-5-mini 免費額度
- [x] **Signal compliance fix** — 強制信號指令讓弱模型更難漏掉

**測試：** 50 pass, 1 skipped（smoke E2E）

---

## 下一步方向

### V3 候選功能

#### 1. Multi-task 平行執行測試
目前 `TaskScheduler` 的 concurrency 設為 3，但還沒有真正測試過多 task 並行。
- 寫一個有 3 個獨立 task 的 spec，驗證它們真的同時跑
- 驗證 `depends-on` 的序列化邏輯

#### 2. 更好的 Cloud CI 整合
目前「no checks → skip → pass」，實際上應該：
- 等 GitHub Actions workflow trigger（最多 30s）
- 再 poll checks
- Timeout 後才算 pass

#### 3. Spec 模板庫
常見任務的 spec 範本：
- `add-python-util.spec.md`
- `add-api-endpoint.spec.md`
- `fix-failing-test.spec.md`

#### 4. Dry-run 模式
`--dry-run` flag：解析 spec、建 prompt、印出來，但不真的呼叫 AI。
用途：確認 prompt 內容是否正確，再決定要不要跑。

#### 5. Reviewer 結果 summary 寫入 PR comment
目前 4 個 reviewer 的結果只影響 pass/fail。
可以把每個 reviewer 的完整意見 post 到 PR comment，讓人工審查有更多參考。

#### 6. 支援更多 runner
| runner | CLI | 狀態 |
|--------|-----|------|
| `claude` | `claude -p` | ✅ 已支援 |
| `copilot` | `copilot -p --autopilot` | ✅ 已支援 |
| `gemini` | `gemini -p` | ⬜ 可加 |
| `codex` | `codex exec` | ⬜ 可加 |

---

## 已知限制

| 限制 | 影響 | 說明 |
|------|------|------|
| gpt-5-mini 弱指令跟隨 | 偶爾不印信號 | 已用 prompt fix 緩解，但非 100% |
| Cloud CI「no checks」 | 不確定 CI 真的跑了 | GitHub Actions 有延遲 |
| reviewer CLI 需要本機安裝 | Gemini/Codex 可能沒裝 | 已做 graceful skip |
| worktree 清理 | 跑失敗後殘留 branch | 需手動 `git branch -D` |

---

## 怎麼驗證系統是健康的

```bash
# 1. 跑單元測試
cd packages/orchestrator && bun run test
# 預期：50 pass, 1 skipped

# 2. 跑 E2E smoke test
rm -f .clawdbot/active-tasks.json
bun packages/orchestrator/orchestrate.ts test-copilot-runner.spec.md
# 預期：看到 [agent] <ready-for-review/>，最後 PR ready

# 3. 確認沒有孤兒 worktree
git worktree list
# 預期：只有 main worktree

# 4. 確認沒有殘留 agent branch
git branch | grep agent/
# 預期：空（或只有當前 E2E 跑的）
```
