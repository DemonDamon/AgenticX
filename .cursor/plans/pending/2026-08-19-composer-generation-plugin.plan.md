# 输入框生成插件与视频任务适配

Planned-with: glm-5.2
Suggested-Impl-Model: glm-5.2

## 目标

在 Desktop 现有聊天输入框的左下角更多菜单中增加「插件调用」级联入口。用户选择已安装且已配置的生成插件后，仍在同一输入框填写提示词、上传当次图片并发送；首个内置插件为视频生成。请求不得进入普通 `/api/chat` / LiteLLM 聊天路径，而应由独立的生成任务适配器发起、轮询并持久化结果。

## 根因与证据

`desktop/src/components/ChatPane.tsx` 的 `sendChat()` 当前构建 `user_input`、`provider`、`model` 与 `image_inputs` 后调用 `/api/chat`。`agenticx/studio/protocols.py` 的 `ChatRequest` 也只描述聊天回合，`agenticx/llms/provider_resolver.py` 仅将自定义 provider 解析成 OpenAI/Ollama 兼容聊天调用。因此将异步视频模型选入聊天模型选择器时，会以聊天协议请求并失败。

## 范围

### In scope

- 通用生成插件注册、配置、执行和任务状态接口。
- 输入框更多菜单的已配置插件级联选择、当前轮附件收集、视频任务消息卡。
- 视频生成插件：确定性请求体映射、参数默认值、可配置提交/查询/取消 URL、轮询和取消。
- 插件设置中复用现有 provider 凭据与模型引用，不重复保存 API Key。
- 显式「优化提示词」动作；默认不调用辅助模型。

### Out of scope

- 独立视频工作台、媒体资产库、历史图片自动引用或任意脚本执行。
- 将视频模型加入普通聊天模型选择器。
- 不支持 data URL 的远程图片存储上传流程。

## 实施步骤

### 1. 定义受控生成插件契约与配置

新增 `agenticx/studio/generation_plugins.py`：

- 使用 dataclass/Pydantic 定义 `GenerationPluginDefinition`、`GenerationPluginConfig`、`GenerationRequest`、`GenerationTask`；配置字段包括：`plugin_id`、`enabled`、`provider`、`model`、`submit_url`、可选 `status_url_template` / `cancel_url_template`、`auth_scheme`、`response_mapping`、`defaults`。
- 内置 `video-generation` 定义必须要求 `provider`、`model`、`submit_url`；允许的默认值为 `resolution`、`ratio`、`duration`、`watermark`，缺省时分别使用 `480p`、`16:9`、`5`、`false`。
- 通过 `ConfigManager` 的原始 YAML 配置增加顶级 `generation_plugins` 区块。凭据只从其引用的 `providers[provider]` 读取；返回给 Desktop 的配置摘要不得含 `api_key`、`secret_key`。
- `resolve_generation_request()` 应按「本次请求显式参数 > 插件 defaults > 内置 defaults」合并；`prompt` 为非空必填。
- 视频 payload 固定构造为 `{ model, content, resolution, ratio, duration, watermark }`。`content` 第一项始终是 `{type: "text", text: prompt}`；当前请求图片按顺序追加 `{type: "image_url", url: data_url}`。

### 2. 独立 HTTP 任务 API 与持久化

在 `agenticx/studio/protocols.py` 增加 `GenerationSubmitRequest`、`GenerationTaskStatus` 等请求/响应模型；在 `agenticx/studio/server.py` 注册：

- `GET /api/generation/plugins`：仅返回 enabled 且其被引用 provider 已配置的插件摘要。
- `POST /api/generation/tasks`：接受 `session_id`、`plugin_id`、`prompt`、当前轮 `image_inputs` 与可选参数；验证 data URL；通过插件 adapter 发起 HTTP 请求。禁止调用 `/api/chat` 或 `ProviderResolver`。
- `GET /api/generation/tasks/{task_id}` 与 `POST /api/generation/tasks/{task_id}/cancel`：基于模板替换 task id，解析 `response_mapping` 中 task id、状态、进度、结果 URL、错误字段。
- 创建一条用户消息和一条助手任务消息，助手行 `metadata.kind = "generation_task"`，包含插件、已解析参数、task id、状态、进度、结果 URL / error。状态变化写回同一任务行，保证重启后可恢复。
- 执行时使用 provider 的 API Key 填充受控鉴权 Header；禁止插件配置中定义任意 Header 或执行代码。上游不接受 data URL 时，将其响应错误原样归类为任务失败并返回可读提示。

### 3. Desktop 输入框插件选择和提交

在 `desktop/src/components/ChatPane.tsx`：

- 扩展 `ComposerMoreActionsButton`，在其现有 hover/flyout 菜单增加「插件调用」子菜单；使用现有 portal 定位逻辑，避免被 composer 的 overflow 裁剪。
- 挂载时获取 `/api/generation/plugins`；仅渲染服务端返回的已配置列表。没有可用插件时不显示该菜单项。
- 增加 pane-local `activeGenerationPlugin` 状态。选择后在 action bar 显示「视频生成」chip 和关闭按钮；取消即恢复既有 `sendChat()` 行为，不修改聊天模型选择。
- 若 chip 激活，发送按钮改为调用 `submitGenerationTask()`：读取 `extractComposerSendText()` 与仅当前 composer 的 ready 图片附件，POST 到 `/api/generation/tasks`；不传 workspace `context_files`、引用消息或历史附件。
- 提交成功后清空当前文本和附件，乐观插入 task 消息；轮询未终态任务，取消时调用取消 API。失败时在 composer 上方的主视区显示可读错误与重试按钮。
- 「优化提示词」只作为 chip 附近显式按钮：复用当前聊天模型的已有请求路径来取得建议，然后仅回填输入框；不得在点击生成时隐式触发。

### 4. 任务卡与恢复

在 `desktop/src/components/messages/` 增加 `GenerationTaskCard`，并在现有消息渲染分派处通过 `metadata.kind === "generation_task"` 渲染：

- pending/running 显示插件名称、参数摘要、百分比或阶段文本和取消按钮；success 显示结果 URL 的视频预览、下载链接与「复用参数」；error 显示错误与重试。
- 会话加载映射应保留 generation metadata。`ChatPane` 发现历史中的 pending/running 任务时恢复轮询，但同一 task id 在同一 pane 最多一个轮询器。

### 5. 设置页

在 `desktop/src/components/SettingsPanel.tsx` 的能力/插件设置区域新增「生成插件」配置块：启用开关、引用 provider/model、提交/状态/取消 URL、响应字段 JSON Path、默认参数。保存失败时保留面板并在触发处显示错误；敏感值不回显。

## 验收与测试

- 新增 Python 测试覆盖：请求默认值优先级；video payload（纯文本和 data URL 图片）；未配置/禁用插件拒绝；凭据不出现在插件列表；提交、轮询、取消、失败映射和 metadata 持久化。
- 新增 TypeScript 测试覆盖：菜单只列出可用插件；选择/取消不影响普通 `sendChat()`；当前附件进入生成请求、历史附件不进入；任务状态卡渲染和恢复轮询去重。
- 执行 Desktop typecheck、相关前端测试和 Python 测试；手动验证普通文本/图片聊天仍经 `/api/chat`，视频生成不经该路由。
