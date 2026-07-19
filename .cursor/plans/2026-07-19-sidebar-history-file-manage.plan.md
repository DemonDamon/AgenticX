# 历史会话文件管理：卡片轮换 + 每会话独立工作区

Planned-with: cursor-grok-4.5
Suggested-Impl-Model: composer-2.5 / gpt-5.x（后端隔离收口）

## 背景

1. 侧栏「文件管理」整页替换历史列表，体感像翻页且慢（先 `await openSession` 再切换）。
2. Trae 为左右卡片轮换；顶栏为返回 + 视图切换 + 更多（添加文件/文件夹/刷新），空态「工作区为空」。
3. Near 旧模型把用户添加的文件夹写入 `global_workspaces.json` 并按 avatar/meta scope 同步到所有会话，删除一处则处处消失。

## In scope

- 历史 ↔ 文件管理：CSS `translate-x` 卡片轮换；先 `ensurePaneForRow` 立即滑入，后台再 `openSession`
- Trae 式侧栏顶栏/空态/更多菜单；列表/树形切换；添加文件（挂父目录）与添加文件夹
- 后端：`add/remove/list` 仅改当前 session 的 `managed.taskspaces` + persist；停止 `_sync_taskspaces_with_global` 注入
- 侧栏文件管理隐藏 `default` 根，只展示本对话「附加」文件夹

## Out of scope

- 不删除 `global_workspaces.json` 文件本身（遗留只读）
- 不改 Meta `align_meta_session_workspace` 身份默认目录（MEMORY 等）
- 不做 Trae「上传拷贝进会话沙箱」；Near 仍为路径引用

## 落点

| 文件 | 改动 |
|------|------|
| `agenticx/studio/session_manager.py` | per-session add/remove/list |
| `tests/test_session_manager_persistence.py` | 隔离断言 |
| `SidebarSessionHistory.tsx` | 卡片轮换 + 快速 ensurePane |
| `WorkspacePanel.tsx` | Trae chrome / 空态 / 视图 |
| `desktop/electron/main.ts` + preload + `global.d.ts` | `choose-files` IPC |

## AC

- AC-1: 点「文件管理」侧栏左右滑入，不再整页闪断；返回可滑回
- AC-2: 会话 A 添加文件夹后，同 Meta 会话 B 列表不可见；从 A 移除不影响 B
- AC-3: 空对话文件管理显示「工作区为空」+ 添加文件/文件夹
- AC-4: 更多菜单含添加文件、添加文件夹、刷新；视图可切列表/树形
- AC-5: `pytest` 相关 taskspace 隔离用例绿
