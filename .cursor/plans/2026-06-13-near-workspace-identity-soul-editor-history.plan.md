# Near 元智能体 IDENTITY / SOUL 编辑与历史回滚

## What & Why

「元智能体（Near）」设置区已支持在输入框内编辑 `IDENTITY.md` 与 `SOUL.md` 并落盘。用户倾向**以输入框为主流程**，不强制「只能打开文件编辑」；同时需要：

1. **辅入口**：在编辑器中打开对应文件（进阶用户 / 长文编辑）。
2. **轻量版本管理**：保存前自动快照，可在 UI 中查看历史并回滚，避免改错人格/身份后无法恢复。

本 plan 不引入 Git、不合并进「记忆管理」Tab，不与分身 `avatars/<id>/SOUL.md` 范围混淆（本期仅 Meta workspace 根目录两份文件）。

## 现状（Baseline）

| 项 | 状态 |
|----|------|
| `~/.agenticx/workspace/IDENTITY.md` | Desktop IPC `load/save-meta-identity`；设置内 textarea |
| `~/.agenticx/workspace/SOUL.md` | Desktop IPC `load/save-meta-soul`；设置内 textarea |
| 运行时注入 | `load_workspace_context()` → `meta_agent.py` 注入「身份定义」「行为准则」 |
| 历史快照 | **无** |
| 打开文件 | 主进程已有 `shell-open-path` IPC，设置页**未接线** |
| 技能 changelog 参考 | `agenticx/skills/versioning.py`（append-only 文本日志，可借鉴思路但不必共用实现） |

## 产品原则

- **主路径**：设置页 textarea 编辑 + 单一「保存」按钮（身份 + 人格任一 dirty 即点亮）。
- **辅路径**：「在编辑器中打开」链接/按钮，不替代保存、不隐藏输入框。
- **不暴露 filesystem 为主心智**：标题可用中文 + 可选 tooltip 说明落盘路径；placeholder 不写完整 `~/.agenticx/...` 路径。
- **版本语义**：「历史记录 / 恢复」，不用 commit、branch、Git 等术语。

## Requirements

### 功能（FR）

- **FR-1**：身份定义、全局人格均在设置内 textarea 编辑；共用一个「保存」按钮，保存时按 dirty 分别调用已有 `save-meta-identity` / `save-meta-soul`。
- **FR-2**：每个区块标题行提供「在编辑器中打开」操作，调用系统默认应用打开对应绝对路径文件（复用 `shell-open-path` 或等价 IPC）。
- **FR-3**：用户点击「保存」且即将写入磁盘前，若当前磁盘内容与即将写入内容不同，先将**当前磁盘上的旧内容**写入历史目录作为快照（避免空草稿覆盖前有值文件时不留档）。
- **FR-4**：历史列表 UI：按文件分开展示（身份 / 人格），每条显示本地时间 + 内容预览（如前 80–120 字，单行截断）。
- **FR-5**：「恢复此版本」：二次确认后，将选中快照写回主文件、刷新 textarea、更新 dirty/saved 基线；可选提示「已恢复，下一轮对话生效」。
- **FR-6**：打开设置页或切回「通用偏好」且 Near 区块可见时，从磁盘 reload 内容；若磁盘内容与上次已保存基线不一致（例如用户曾在外部编辑器修改），弹出轻提示：「检测到文件已在外部修改，是否加载最新内容？」（加载 / 保留当前编辑草稿二选一）。
- **FR-7**：保存成功提示合并为一条中性中文文案（例如「已保存，下一轮对话生效」），避免身份/人格两条英文/中文混排 toast。

### 非功能（NFR）

- **NFR-1**：历史目录位于 `~/.agenticx/workspace/.history/`，不进入记忆检索主路径展示（可选：后续在 loader 侧排除 `.history`；本期至少不向用户暴露该目录为「记忆」）。
- **NFR-2**：每个文件（identity / soul）保留最近 **10** 份快照；超出时删除最旧（按文件名时间戳或 index 排序）。
- **NFR-3**：快照文件名使用 UTC 或本地时间戳 `YYYYMMDD-HHmmss.md`，避免特殊字符；内容 UTF-8 原文，不压缩。
- **NFR-4**：恢复与保存操作失败时，设置页内联错误文案，不静默失败。
- **NFR-5**：Electron 主进程改 IPC 后需完全重启 dev（⌘Q / 重启 `npm run dev`），与现有 Desktop 规范一致。

### 验收（AC）

- **AC-1**：未修改身份/人格时「保存」为禁用；修改任一侧后保存可点，保存后两侧 dirty 均清除（仅保存有改动的文件）。
- **AC-2**：点击「在编辑器中打开」能用系统默认方式打开 `IDENTITY.md` / `SOUL.md`（macOS 上通常为关联编辑器或预览）。
- **AC-3**：连续保存 3 次后，历史列表至少可见 2 条可恢复快照（第 1 次保存前若文件为空可能无快照，需在 UI 空态说明）。
- **AC-4**：从历史恢复后，textarea 内容与磁盘主文件一致；下一轮 Meta 对话使用的 system prompt 块与恢复后内容一致（可手工改 SOUL 一句明显话术验证）。
- **AC-5**：在外部编辑器修改 SOUL 后重新打开设置，出现「是否加载最新内容」提示；选加载则 textarea 与磁盘一致。
- **AC-6**：历史仅作用于 Meta `workspace/IDENTITY.md` 与 `workspace/SOUL.md`，不改动分身目录下文件。

## 范围外（Non-Goals）

- 分身 `avatars/<id>/IDENTITY.md` / `SOUL.md` 的历史与打开编辑器（可后续复用同一组件）。
- `USER.md` / `MEMORY.md` 的历史 UI（USER 由「用户档案」保存同步；MEMORY 已有记忆管理）。
- 双栏 diff、Git 集成、云端同步历史。
- Studio REST 侧编辑这两份文件（本期仅 Desktop 设置 + Electron IPC）。

## 技术方案

### 1. 历史存储布局

```
~/.agenticx/workspace/
  IDENTITY.md
  SOUL.md
  .history/
    identity/
      20260613-092701.md
      ...
    soul/
      20260613-093012.md
      ...
    index.json          # 可选：缓存列表元数据，加速 UI；无则 scan 目录
```

`index.json` 结构（可选）：

```json
{
  "identity": [{ "id": "20260613-092701", "savedAt": "2026-06-13T09:27:01+08:00", "preview": "..." }],
  "soul": [...]
}
```

### 2. Electron 主进程

在 `desktop/electron/main.ts` 扩展（建议集中为 `workspaceSoulHistory` 小模块或同文件内函数，避免 SettingsPanel 膨胀）：

| IPC | 说明 |
|-----|------|
| `list-meta-workspace-history` | `{ kind: "identity" \| "soul" }` → `{ ok, items: [{ id, savedAt, preview }] }` |
| `restore-meta-workspace-history` | `{ kind, id }` → 读快照写回主路径，返回 `{ ok, content }` |
| `snapshot-meta-workspace-before-save` | `{ kind, currentDiskContent? }` 内部在 save 前由 save handler 调用 |

**保存流程改造**（`save-meta-identity` / `save-meta-soul`）：

1. 读取磁盘当前内容 `old`。
2. 若 `old` 非空且 `old !== payload.content`，写入 `.history/<kind>/<timestamp>.md`，并 prune 至 10 条。
3. `writeFileSync` 主文件。
4. 返回 `{ ok: true }`。

**打开编辑器**：复用已有 `shell-open-path`，preload 暴露 `openPathInShell(path)`（若尚未暴露给渲染进程则补充）；Near 区块传 `META_IDENTITY_PATH` / `META_SOUL_PATH` 常量可由 IPC `get-meta-workspace-paths` 返回，或渲染进程只传 kind 由主进程解析路径（更安全）。

### 3. 设置页 UI（`SettingsPanel.tsx` Near Panel）

在「身份定义」「全局人格」标题行右侧：

```
身份定义（IDENTITY.md）          [在编辑器中打开]
[ textarea 3 rows ]

全局人格（SOUL.md）              [在编辑器中打开]
[ textarea 5 rows ]

[ 历史记录 ▾ ]  （折叠面板，内部分「身份」「人格」两 tab 或两组列表）
… 09:27  - Name: Near …          [恢复]
… 09:15  …                       [恢复]

                    [已保存提示]  [保存]
```

- 「在编辑器中打开」：文字链样式，对齐用户档案头像区「更换」链接，不用大边框按钮。
- 「历史记录」默认折叠，展开后懒加载 `list-meta-workspace-history`。
- 「恢复」使用应用内主题化确认弹窗（`confirmDialog`），文案：「将用该历史版本覆盖当前文件与编辑区内容，是否继续？」

### 4. 外部编辑检测

- 打开设置 / 进入 general tab 时：并行 `loadMetaIdentity` + `loadMetaSoul`。
- 维护 `metaIdentitySaved` / `metaSoulSaved` 与磁盘内容比较；若磁盘 ≠ saved 且 textarea 仍等于 saved（用户未在 UI 内改），提示加载。
- 若用户已在 textarea 改了草稿（dirty），**不自动覆盖**；可在历史区加一行弱提示「磁盘文件可能已在外部修改」。

### 5. 与运行时一致性

- 保存/恢复只动 `~/.agenticx/workspace/*.md`；`meta_agent.py` 每轮 `load_workspace_context()` 读磁盘，**无需**改 Python 即可下一轮生效。
- 若存在 workspace 内存索引缓存，确认 `WorkspaceMemoryStore` 对 `.history` 不索引或忽略（grep 后按需加 exclude）。

## 实施顺序（建议 3 commit）

1. **ipc-history-core**：主进程 history 目录、snapshot on save、list/restore IPC；preload + `global.d.ts`；冒烟测试（可选 Node 侧单测 history prune）。
2. **ui-open-editor**：Near 区块「在编辑器中打开」+ reload 外部修改提示。
3. **ui-history-panel**：折叠历史列表 + 恢复 + 保存提示合并；与现有单一「保存」按钮联动。

每 commit 附 `Made-with: Damon Li`；使用 `/commit --spec=.cursor/plans/2026-06-13-near-workspace-identity-soul-editor-history.plan.md`。

## 测试计划

| 场景 | 步骤 | 期望 |
|------|------|------|
| 保存快照 | 改 SOUL 保存两次 | `.history/soul/` 有 ≥1 文件 |
| 恢复 | 从历史恢复旧版 | textarea + 磁盘一致 |
| 打开编辑器 | 点链接 | 系统打开 md 文件 |
| 外部编辑 | 记事本改 SOUL，重开设置 | 提示加载 |
| dirty 保护 | UI 有未保存草稿 + 外部已改 | 不静默覆盖草稿 |
| prune | 保存 12 次 | 目录内 ≤10 个 soul 快照 |

手动验收为主；若有 `desktop` 相关测试 harness，可对 history prune 纯函数加单元测试。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `shell.openPath` 在部分环境打开方式不符合预期 | 文案为「在编辑器中打开」而非承诺特定 IDE；后续可加「在 Cursor 中打开」配置项 |
| 历史目录膨胀 | 严格 10 条上限 + 仅文本 md |
| 恢复后用户未点保存即关设置 | 恢复即写盘，与「恢复=落盘」语义一致；提示「已恢复」 |
| 中英文混排回归 | 保存/恢复提示统一中文 product 文案 |

## 关联文档与代码

- `agenticx/workspace/loader.py` — `IDENTITY.md` / `SOUL.md` 模板与 `load_workspace_context`
- `agenticx/runtime/prompts/meta_agent.py` — workspace 块注入顺序
- `desktop/electron/main.ts` — `META_IDENTITY_PATH` / `META_SOUL_PATH`、`shell-open-path`
- `desktop/src/components/SettingsPanel.tsx` — Near Panel UI
