---
name: im-channel-model-follow-and-fallback
overview: 让飞书/微信 IM 渠道与绑定会话的模型保持实时一致；当该模型在 IM 场景下调用失败（如 invalid chat setting/unsupported params）时，自动回退到 openai/gpt-5-chat 并在回复中提示。
todos:
  - id: trace-im-model-source
    content: 梳理飞书/微信当前 session->provider/model 解析链并确定统一取值优先级
    status: completed
  - id: extend-binding-schema
    content: 扩展飞书/微信绑定持久化字段支持 provider/model 并保持旧数据兼容
    status: completed
  - id: wire-provider-model-in-chat
    content: 在 IM 的 /api/chat 请求中显式传入 provider/model，保证会话实时跟随
    status: completed
  - id: add-fallback-policy
    content: 实现 IM 参数兼容错误的单次自动回退到 openai/gpt-5-chat 并附提示
    status: completed
  - id: verify-both-channels
    content: 完成飞书/微信双渠道切模与回退场景验证并记录日志证据
    status: completed
isProject: false
---

# IM 渠道模型实时跟随与失败回退实施计划

## 目标与验收
- IM（飞书、微信）不再固定走默认 provider；而是使用“绑定会话当前模型”。
- 当绑定会话被桌面切换模型后，IM 下一条消息立即使用新模型（无需重新绑定）。
- 若当前模型在 IM 调用中出现参数兼容错误（典型 `invalid chat setting (2013)` / `UnsupportedParamsError`），自动回退到 `openai/gpt-5-chat`。
- 回退时在 IM 回复中追加一行短提示（例如“已自动回退到 openai/gpt-5-chat”）。

## 现状与关键切入点
- IM 适配器调用 `/api/chat` 时未传 `provider/model`：
  - `agenticx/gateway/feishu_longconn.py` 的 `_chat_turn()`。
  - `agenticx/gateway/adapters/wechat_ilink.py` 的 `_chat_turn()`。
- `/api/chat` 已支持 `provider/model` 覆盖并写入 `session.provider_name/model_name`：
  - `agenticx/studio/server.py` 的 `chat()` 与 `ChatRequest`。
- Desktop 已按 pane/session 维护模型，但绑定文件当前只存 `session_id/avatar_id/avatar_name`：
  - `desktop/electron/main.ts`（`save-feishu-desktop-binding` / `save-wechat-desktop-binding`）。

## 实施步骤
1. 在 IM 适配器里引入“会话模型解析”
- 为飞书、微信新增统一的会话模型解析逻辑：优先读取绑定对象里的 `provider/model`（后续扩展字段），若无则从会话接口读取当前会话元数据（必要时新增轻量 API/复用现有会话状态返回）。
- 在两条 `_chat_turn()` 请求体中显式带上 `provider` 与 `model`，确保 IM 请求与绑定会话模型一致。

2. 扩展绑定 payload（前后端同构）
- Desktop 绑定写入增加可选字段：`provider`、`model`（snake_case 持久化）。
- 飞书/微信绑定读取处兼容新旧结构（旧数据无该字段不报错）。
- 这样在“刚切换模型但会话尚未产生新轮次”时，IM 仍可直接拿到最新目标模型。

3. 增加 IM 专用失败回退策略
- 在飞书/微信 `_chat_turn()` 外层捕获模型参数兼容类错误（`invalid chat setting`、`UnsupportedParamsError`、明确的 4xx 参数错误）。
- 命中后以同一 `session_id` 重试一次，强制 `provider=openai, model=gpt-5-chat`。
- 成功后将“回退提示”拼接到回复前缀（短句、单次提示）；重试仍失败则返回原错误简报。

4. 配置与可观测性
- 新增（或复用）配置项控制回退开关与目标模型（默认启用并指向 `openai/gpt-5-chat`）。
- 记录结构化日志：原 provider/model、错误摘要、回退目标、回退结果，便于排障。

5. 验证用例
- 飞书：绑定会话 A，桌面将 A 从 `minimax/*` 切到 `zhipu/*`，IM 下一条应直接走 zhipu。
- 微信：同样流程验证。
- 触发兼容错误场景：切回易触发 2013 的模型，IM 应自动回退并成功回复，且提示文案出现。
- 回归：未绑定时维持当前默认逻辑；旧 binding 文件可正常读取。

## 涉及文件（预计）
- `agenticx/gateway/feishu_longconn.py`
- `agenticx/gateway/adapters/wechat_ilink.py`
- `agenticx/gateway/client.py`（若统一抽公共逻辑）
- `agenticx/studio/protocols.py`（若需补充字段/注释）
- `desktop/electron/main.ts`
- `desktop/electron/preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/components/ChatPane.tsx`（如需在绑定时同步 provider/model）
- `desktop/src/components/SessionHistoryPanel.tsx`（如需绑定菜单同步）

## 风险与控制
- 风险：provider/model 来源不一致（pane 与 session 竞态）。
- 控制：IM 只以“绑定会话 + 显式 provider/model”发起请求；失败后单次回退，避免循环重试。
- 风险：旧 binding 数据兼容。
- 控制：读取时字段可选、写入保持向后兼容。