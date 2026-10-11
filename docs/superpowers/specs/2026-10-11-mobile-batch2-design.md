# 手机端第二批功能升级设计（Mobile Batch 2）

日期：2026-10-11
状态：设计已获用户确认（方案 1 + A 方案 + 懒创建均拍板）
前置：第一批品牌化 UI 已交付并提交（d665593a1）

## 背景与目标

手机端第一批只完成了品牌化外观。第二批解决三个功能性缺口（对照桌面端 Trae 体验）：

1. **新建任务入口**——目前只能看已有会话，无法从手机发起新任务；
2. **Markdown 渲染**——AI 回复目前按纯文本展示，代码块/列表/标题全糊成一行；
3. **工具调用结构化展示**——网关把 SSE 压扁成「开始：X / 完成：X」进度行，看不出 AI 执行了什么命令。

**已确认的关键决策：**

- 执行过程展示采用**方案 1：完成态结构化时间线**（回合结束后渲染分组折叠卡），不做实时流式——流式留待下一阶段；
- 技能/插件采用**A 方案：只读浏览**（不做启用/停用管理），放在新建任务页展示「Near 会什么」；
- 新建任务交互：会话列表右上角**「+」圆钮** → 空白任务页；**懒创建**（首条消息发出时才真正创建会话，放弃空任务不产生垃圾会话）。

## 数据链路调研结论（设计依据）

- `~/.agenticx/sessions/<id>/messages.json` 中 tool 消息已含 `{role:"tool", content, tool_call_id, tool_name, tool_args, tool_status:"done"|"error", timestamp}`；assistant 消息含 `reasoning` 字段。**数据现成，网关 `session.messages` 原样透传，手机端归一化时被丢弃了**——本批改造的切入点。
- 桌面端参考实现：`desktop/src/store.ts`（Message 结构）、`ToolCallCard.tsx`（标题/状态）、`TurnToolGroupCard.tsx`（分组）、`group-tool-messages.ts`（分组规则）。
- studio 侧可复用接口：`POST /api/sessions`（server.py:6186）、`GET /api/tools/registry`（server.py:5831）、`GET /api/mcp/servers`（server.py:5251）——网关均未透传。

## 一、数据链路与网关改造（最小增量）

网关 `_dispatch_device_rpc`（agenticx/gateway/client.py）新增 3 个转发：

| RPC method | 转发到 | 用途 |
|---|---|---|
| `sessions.create` | `POST /api/sessions` | 懒创建会话 |
| `tools.registry` | `GET /api/tools/registry` | 技能列表 |
| `mcp.servers` | `GET /api/mcp/servers` | MCP 插件连接状态 |

原则：

- `session.messages` 保持原样透传，**消息归一化全部移到手机端**，网关不碰消息结构；
- 转发为薄封装：透传请求体/查询参数与 studio 响应，studio 非 2xx 时透传错误码与摘要；
- 复用现有 desktop token 鉴权头。

## 二、手机端消息模型 + Markdown 渲染

- `MobileMessage`（mobile/src/api/types.ts）扩展：`tool_call_id / tool_name / tool_args / tool_status / reasoning`；归一化函数（sessions/[id].tsx 内）保留这些字段，不再丢弃；
- 容错：老会话消息缺字段时按现有纯文本逻辑回退，不崩溃；
- Markdown 选型：**react-native-markdown-display**（纯 RN、无 webview 依赖、样式可完全自定义）；
- 只对 **AI 回复**启用 Markdown；用户气泡保持纯文本；
- Markdown 主题对齐品牌 tokens：代码块暖色深底 + mono 字体、标题/链接用 brand.primary、正文用现有文字色。

## 三、工具调用分组卡片（方案 1：完成态）

- 新增纯函数 `groupToolMessages(messages)`：**同一回合内连续的 tool 消息归为一组**（遇 user/assistant 边界断组；规则简化自桌面端 group-tool-messages.ts）；
- 分组渲染为一张折叠卡：收起态显示「执行 N 个步骤 ›」（进行中显示「执行中…」）；展开态逐条显示：
  - 状态图标（✓ done / ✕ error）+ 工具名；
  - 明细：`bash_exec` 显示 `tool_args.command`（mono 字体），其它工具显示参数摘要（JSON 键值截断）；
  - 有结果 content 时附一行截断预览（≤120 字符）；
- assistant 消息带 `reasoning` 时，在其上方渲染可展开的**「思考过程」**折叠块；
- 回合进行中（等待最终回复、轮询期间）分组卡显示执行中状态；轮询刷新 messages 后自然变为完成态。**不做实时流**。

## 四、新建任务页 + 懒创建

- 会话列表（sessions.tsx）右上角「+」圆钮 → 新路由 `app/new-task.tsx`；
- 页面构成：品牌 hero（logo + 标题）→ 多行输入框（默认聚焦）→ 发送按钮 → 底部「Near 会什么」只读卡；
- **懒创建链路**：页面加载不调 `sessions.create`；用户发出首条消息时：
  1. `sessions.create` 拿到 `session_id`；
  2. `session.send` 发送消息；
  3. `router.replace` 跳转会话页（sessions/[id]），保证返回键不回到 new-task；
- 发送中禁用按钮并显示 loading；create 失败显示错误并保留输入内容。

## 五、技能/插件只读卡（A 方案）

- new-task 页底部「Near 会什么」区块：
  - 技能卡：名称 + 一句话描述（来自 `tools.registry`）；
  - MCP server：名称 + 连接状态点（来自 `mcp.servers`）；
- **只读展示，不做任何启停操作**；接口失败时区块整体隐藏或显示一行错误，不阻塞输入框。

## 六、测试与验收

- **网关单测**：3 个新 RPC 的转发正确性（mock studio 响应）+ 非 2xx 错误透传；
- **手机端单测**：`groupToolMessages` 分组边界、归一化字段保留与老消息容错；
- **端到端（模拟器）**：
  1. 会话列表点「+」→ new-task 页 → 输入触发 bash 的任务 → 发送 → 跳转会话页；
  2. 回合完成后：Markdown 正常渲染、出现「执行 N 个步骤」分组卡、点开可见命令明细、「思考过程」可展开；
  3. 技能/插件卡正常展示；
  4. `tsc --noEmit` 通过、`pytest` 网关用例全绿。

## 非目标（本批不做）

- 实时流式渲染（方案 2，下一阶段）；
- 技能/插件启停管理；
- 会话删除/重命名等管理功能。
