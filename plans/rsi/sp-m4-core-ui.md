# SP-M4 — 核心界面：会话列表 / 消息流 / 审批 / 指令

## 背景与动机

SP-M3 骨架 + 配对就绪后，实装 APP 的四个核心界面。数据全部来自
`/api/mobile/*`（SP-M2），纯 JS 层，零原生依赖新增。

## 方案

### 会话列表（sessions.tsx）

- `GET /api/mobile/sessions`，`usePolling`（10s，前台时）
- 行：标题/最近时间/运行状态；设备离线时全列表降级提示 + `GET status` 心跳
- 下拉刷新（RefreshControl）

### 消息流（sessions/[id].tsx）

- 进入拉 `GET sessions/{sid}/messages`；`@shopify/flash-list` 渲染
  user/assistant 气泡 + 工具进度行（progress 数据在 send 响应里，随回合刷新）
- 底部输入框 → `POST sessions/{sid}/send`（发送中禁用输入 + 「执行中」态，
  回复整块落地后刷新；v1 非流式，master plan 已定）
- 发送超时/失败：保留输入草稿 + 错误提示，可重试

### 审批卡（全局轮询）

- `GET /api/mobile/confirms` 5s 轮询（前台）→ 有 pending 时顶部悬浮卡：
  问题文本 + 批准 / 拒绝（拒绝可选原因）
- `POST /api/mobile/confirms/{request_id}` 后立即刷新 confirms + 当前会话消息
- approve/deny 后卡片消失；TTL 过期（桌面端 300s）自然消失

### 绑定管理（settings.tsx）

- 显示 device_id / 桌面名 / 在线状态；`DELETE /api/mobile/bindings` 解绑回配对页

### 状态机纪律

- 三态渲染：loading / 数据 / 错误，每屏显式处理；无全局 loading 遮罩
- 所有网络错误映射为人话（离线 / 超时 / 未授权→踢回配对页）

## 验收标准

- `tsc --noEmit` 零错误
- 手动全路径：列表 → 进会话 → 发指令 → 桌面端触发 confirm_required →
  APP 审批卡出现 → 批准 → 消息流出结果 → 拒绝路径同验
- 桌面离线 / 网关超时 / token 失效三负路径提示正确
- 提交 AgenticX main

## 非目标

- 流式 token、推送唤醒、多语言、深色模式（后续迭代）
