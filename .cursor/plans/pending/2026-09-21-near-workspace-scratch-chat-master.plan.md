# 工作区临时对话 主计划

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: 见各子计划。01/03 数据与入口用 Composer 2.5；02/04/05 工作区 tab、发送与浮层用需前端品味的中高档。
Plan-Id: 2026-09-21-near-workspace-scratch-chat-master
Status: active
Owner: Damon Li
Design: `docs/plans/2026-09-21-workspace-scratch-chat-design.md`

> **For implementer:** 本文件只负责编排。每次只把一个子计划从 `.cursor/plans/pending/` 移到 `.cursor/plans/` 根目录，按该子计划做完、测试绿、commit 一次，再开始下一项。不要把多个子计划揉进同一次 commit。

---

## 1. 产品结论

选中当前 session 里的对象，在右侧工作区开一张临时对话；可浮出；关浮窗收回 tab；不进侧栏历史。主窗格不拆分。第一次发送才 `createSession`。

## 2. 子计划清单

| 顺序 | Plan | 交付 | 依赖 | 规模 | 推荐模型 |
|---|---|---|---|---|---|
| 01 | `2026-09-21-near-workspace-scratch-01-model.plan.md` | 类型、upsert/float/close、store、workspace 持久化、侧栏历史过滤 | 无 | S | Composer 2.5 |
| 02 | `2026-09-21-near-workspace-scratch-02-workpanel-tab.plan.md` | WorkPanel scratch tab + 空卡片壳 | 01 | M | 前端品味档 |
| 03 | `2026-09-21-near-workspace-scratch-03-open-from-message.plan.md` | 气泡/划词「开临时对话」 | 02 | S | Composer 2.5 |
| 04 | `2026-09-21-near-workspace-scratch-04-runtime.plan.md` | 独立 session 发送 / SSE，不写回主窗格 | 02 | M | Composer 2.5 / Codex |
| 05 | `2026-09-21-near-workspace-scratch-05-float.plan.md` | 应用内浮窗、拖动、关窗收回、同时只浮一张 | 02+04 | M | 前端品味档 |
| 06 | `2026-09-21-near-workspace-scratch-06-more-sources.plan.md` | 文件/终端/产物/改动/参考/待办/页内选区入口 | 03 | S | Composer 2.5 |

## 3. 全局边界

- 不新开 Electron 窗口。
- 不替换「引用至新对话」。
- 不自动代问。
- 第一期不做「提到主窗格」（只预留）。
- 不改 `agenticx/studio/server.py` import 区。
- 每个改动必须能追溯到对应子计划 FR。

## 4. 提交约定

每个子计划一次 commit。trailer：

```
Plan-Id: 2026-09-21-near-workspace-scratch-0N-...
Plan-File: .cursor/plans/2026-09-21-near-workspace-scratch-0N-....plan.md
Plan-Model: Cursor Grok 4.6
Impl-Model: Cursor Grok 4.6
Made-with: Damon Li
```

主计划与设计文档随 01 一起提交。
