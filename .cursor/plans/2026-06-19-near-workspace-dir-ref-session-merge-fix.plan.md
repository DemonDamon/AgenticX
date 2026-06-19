# Near 工作区目录引用 + 会话消息合并顺序修复

Planned-with: （待用户补充）

## 背景

1. 工作区面板仅支持单文件 `@` 引用，文件夹无法右键/拖拽到输入框。
2. 长会话 tail 分页 + 流式结束后 `mergeTailFromDisk` 全量合并时，旧消息被 append 到列表末尾，表现为「最新一轮插入历史中间」。

## 范围

- `desktop/src/components/WorkspacePanel.tsx`
- `desktop/src/components/ChatPane.tsx`
- `desktop/src/utils/workspace-drag.ts`（新建）
- `desktop/src/utils/workspace-file-path.ts`
- `desktop/src/utils/session-message-merge.ts`
- `desktop/src/utils/session-message-merge.test.ts`

## 需求

### A. 工作区目录引用

- FR-A1: 文件夹右键菜单提供「引用到输入框」
- FR-A2: 文件夹行提供 `@` 按钮，行为对齐文件引用
- FR-A3: 工作区根目录支持引用/拖拽
- FR-A4: 文件/文件夹可拖拽到 composer，插入 `@label` 并写入 context（目录走 `@dir:` 别名）
- AC-A1: 引用 `scripts/` 后输入框出现 `@scripts` token，请求携带目录清单 context

### B. 会话消息合并顺序

- FR-B1: `mergeSessionMessagesTail` 以磁盘 chronological order 为基准重建列表
- FR-B2: 内存 uid 行与磁盘 positional id 行按 id / role+content 对齐并保留 streaming enrichments
- FR-B3: 仅尚未落盘的内存 tail 追加在末尾
- AC-B1: 内存仅含最新一轮、磁盘含全量历史时，输出顺序与 messages.json 一致
- AC-B2: `session-message-merge.test.ts` 新增回归用例通过

## 验收

- [ ] 工作区文件夹右键 / `@` / 拖拽三种路径均可引用
- [ ] session `aa057579-580e-4cf9-bcd4-f0ce603335ae` 新消息后历史不再错位
- [ ] `npx vitest run src/utils/session-message-merge.test.ts` 绿
