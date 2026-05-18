# Machi 模型记忆 + 窗口布局恢复 · 设计与实施 Plan

日期: 2026-04-21  
作者: @damonli

## 问题

1. 每次冷启动 Machi 桌面端，聊天框左下角显示「未选模型」。  
   根因: `useAppStore.activeProvider/activeModel` 初始化为 `""`，且 store 没有任何持久化层；`panes[]` 亦只在内存中。
2. 同一个分身下不同 session 可能想用不同模型，但切换到旧 session 时前端无法回显上次用的模型。
3. 分身（Avatar）缺少"默认模型"概念；新建 session 时只能回退到全局 `settings.defaultProvider`。
4. Electron 主窗口位置/尺寸在每次打开后被重置为 900×700。
5. 上次打开的 pane 布局（几个窗格分别绑定的 avatar/session/model）无法恢复。

## 目标

启动 Machi 后，用户看到的状态 ≈ 上次关闭时的状态：窗口位置尺寸、pane 布局、每个 pane 绑定的 avatar/session、每个 session 用的模型。

## 非目标

- 不做跨设备/云端同步（纯本地持久化）。
- 不恢复 pane 的运行时重型状态：messages / terminalTabs / spawnsColumn / sessionTokens。
- 不做"任意窗口位置多屏联动"之类的 Edge feature。

## 设计

### 1. 模型记忆

| 数据 | 存储 | 备注 |
|---|---|---|
| Avatar.defaultProvider / defaultModel | 后端 `avatar.yaml`（已支持）+ 前端内存 | `POST/PUT /api/avatars` 已能透传 |
| Session 当前 provider / model | 后端 `StudioSession.provider_name/model_name`（已有） | 前端需要 `list_sessions` 返回 + 新增 `POST /api/sessions/{id}/model` 即时落盘 |
| 全局默认 | `settings.defaultProvider` + `providers[*].model`（已有） | 仅作最末 fallback |

**优先级链**（用户点选某 pane / 进入某 session 时）:

```
session.provider/model  >  avatar.defaultProvider/defaultModel  >  settings.defaultProvider + providers[default].model  >  ""（展示"未选模型"）
```

### 2. 窗口 & 布局

落盘位置: **Electron `userData/layout.json`**（统一主进程管理 bounds + panes；不放 localStorage）。

```jsonc
{
  "mainWindow": { "x": 120, "y": 80, "width": 1280, "height": 900, "isMaximized": false },
  "panes": [
    { "id": "pane-meta", "avatarId": null, "sessionId": "sess_abc",
      "modelProvider": "openrouter", "modelName": "anthropic/claude-opus-4.5" }
  ],
  "activePaneId": "pane-meta"
}
```

- **只记索引级字段**，messages/terminal/token 等不落盘。
- **失效降级**: 某 sessionId 在后端已消失 → 该 pane 退化为空白 meta pane，不整个失败。
- **首次启动** / `layout.json` 不存在 → 行为与当前一致。

## 切片

| ID | 范围 | 风险 |
|---|---|---|
| S1 | `session_manager.list_sessions()` 返回 `provider`/`model` | 低（纯追加字段） |
| S2 | 新增 `POST /api/sessions/{id}/model` | 低 |
| S3 | 前端 `Avatar` 类型 + 两个对话框加默认模型选择器 + 接通 API | 中（涉及 UI） |
| S4 | `store.setActivePaneId` 新优先级链 | 低 |
| S5 | `ChatPane` 模型切换调用 S2 | 低 |
| S6 | Electron `layout.json` + bounds 恢复 + IPC | 中 |
| S7 | `App.tsx` bootstrap 接入 pane 快照恢复 + debounced 写回 | 中 |

## 测试思路

- 手测: 冷启动后模型标签不再显示"未选模型"；分身切换 + session 切换的模型回显；关闭→重开窗口位置/布局一致。
- 回归: 首次启动（`layout.json` 不存在）行为不变。
- 边界: 外接显示器拔掉后窗口位置落在不可见区域 → clamp 回主屏。

## 已知非阻塞问题（不在本次范围）

- `studio_session.provider_name/model_name` 是否随 session 异步持久化到磁盘（跨进程重启是否丢）需要再确认；如有缺失，作为 follow-up。
