# SP-E: 桌面端集成 + 种子案例（master agent 主导验收）

> **批次**: 3（依赖 SP-A/B/C/D 全部合入）
> **注意**: 桌面端验收由 master agent 通过 computer use 真机执行（用户硬性要求）。
> **红线**: 不得改动 `desktop/src/components/SettingsPanel.tsx`、`QrConnectModal.tsx`、`fresh-task-workspace.ts`、`desktop/locales/**`（用户本地未提交改动，冲突风险）。

## 目标

1. Near 桌面端 WikiBrowseView 渲染 case-entry 页面（验证零改动或最小改动：type=case 在 TYPE_COLOR 缺省色系内降级显示即可，不要求改色）
2. 端到端闭环演示数据：用本计划自身落地过程作为种子案例（决策 D4，吃狗粮）
3. Master agent 端到端验收（CLI 闭环 + 桌面端 computer use 真机验收）

## 改动点

### 1. 桌面端（预期零改动，若有阻塞再最小修）

- 先验证：`wiki_compiler.py` 的 wiki 目录约定（`wiki/{entities,concepts,...}`）已能被 WikiBrowseView 渲染；case-entry 若落 `cases/` 目录而非 `wiki/`，则验证 `listWikiPages` API 是否只扫 `wiki/`
- 若 case 页面必须进 `wiki/` 才可见：SP-C 的 CaseStore.save 增加 `--link-to-wiki` 选项，在 `wiki/cases/` 下写同内容页面（symlink 或复制，取跨平台安全的复制），frontmatter type 用已有类型集内的值降级（如 synthesis）+ 正文首行标注 `type: case`——**不改前端**为第一原则
- 桌面端代码改动仅在上述方案都不通时才做，且单文件最小 diff

### 2. 种子案例（吃狗粮）

`cases/default/agent-dev/agenticx-case-library-slice.md`：
- 用 `compile_case_entry` 规则式生成后人工补全
- problem：B 端需要项目经验可沉淀可复用
- solution：垂直切片（delivery Agent 化 + 沉淀触发 + case 模型 + 消费注入）
- artifacts：本分支产出的 wiki 页面 + plans/b-end-case-library/*.md
- scope：domain=agent-dev, team_size=1-5

### 3. Master E2E 验收（本人执行，不派 agent）

1. `python -m pytest tests/ -k "plan_mdc or case or stage_agent or delivery" -x -q` 全绿
2. CLI 闭环：临时目录 → 构造 plan（intent=示例需求）→ dry-run 模式跑 delivery → `case compile` → `case search` 命中 → `case init` 注入新目录 → 检查注入产物
3. 桌面端 computer use 真机：启动 Near 桌面端 → WikiBrowseView 树形视图看到 case 页面 → 点开正文显示 问题/方案/结果 三段 + frontmatter 来源 →（若图谱视图可用）图谱中节点出现
4. 分支 commit 按 SP 分组；`git diff main --stat` 不含红线文件

## 不做

- 不做桌面端新 UI 组件/改色/新视图
- 不做 enterprise/ 任何改动
- 不做 mobile/
