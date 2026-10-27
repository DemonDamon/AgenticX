---
source: https://ark.volcengine.com/region:cn-beijing/docs/sessions-events-reference-v2
fetched: 2026-10-24
title: 会话事件结构参考
---

# 会话事件结构参考

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

托管智能体会话通过事件实现客户端与服务端之间的双向通信。客户端可以发送消息、控制指令和工具执行结果；服务端会推送 Agent 回复、Session 状态和模型调用信息。流式订阅还可以返回用于增量展示内容的瞬时预览帧。本参考文档说明各类事件和预览帧的结构、字段含义与触发时机。

> **说明**
>
> - 客户端事件通过 [发送会话事件](send-event-api.md) 接口提交；服务端事件可通过 [流式获取会话事件](stream-events-api.md) 实时消费，或通过 [获取会话事件列表](list-events-api.md) 查询历史。预览帧只在流式接口中出现。
> - 如需发送、实时接收或断线补查事件，请参见 [Session 事件流](../session-event-stream.md)。
> - 客户端发送事件时，公共字段中的 `id`、`processed_at` 等由服务端自动生成，客户端仅需要填写事件类型（`type`）和对应业务字段即可。
> - `system.message` 必须与一条 `user.message` 放在同一个 `events` 数组中，并紧跟在该 `user.message` 后发送；单独发送 `system.message` 会被服务端拒绝。
> - 多态对象通过 `type` 字段区分具体结构。客户端应先读取 `type`，再按对应变体解析其余字段。
> - 事件 ID、结果评估 ID 和线程 ID 分别以 `sevt-`、`outc-` 和 `sthr-` 开头。
> - `user.message` 的 `content[]` 支持 `video` 内容块：
>   - `fps`：抽帧频率，取值范围为 0.2～5；省略时使用下游模型的默认策略。
>   - `source.type`：视频来源类型，支持以下取值：
>     - `url`：使用公网可访问的视频 URL。可处理的视频大小以下游模型的输入限制为准。
>     - `base64`：使用 Base64 编码的视频，媒体类型支持 `video/mp4`、`video/x-msvideo` 和 `video/quicktime`。
>     - `file`：使用 Files API 上传的视频文件 ID。
> - `event_start` 和 `event_delta` 仅在流式接口通过 `event_deltas` 参数显式订阅后返回，不写入事件历史。每个预览帧都有独立的顶层 `id` 和 `processed_at`；使用 `event_start.event.id` 或 `event_delta.event_id` 关联最终完整事件。
> - 订阅主线程时也可能收到子线程的创建和状态变化通知；子线程内部消息仍需订阅或查询对应线程。流式响应可能为线程内事件补充 `session_thread_id`，事件历史接口可能省略该字段。下方事件结构仅列出事件自身定义的字段。

## 客户端发送事件（请求）

### user.message

> 用户向智能体发送消息时触发

**type** `string` | 事件类型

`user.message.type`

事件类型，固定为 `user.message`

**id** `string` | 事件 ID

`user.message.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`user.message.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`user.message.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**content** `object[]` | 消息内容

`user.message.content`

消息内容块列表，支持文本、图片、文档和视频四种类型

**文本** `object`

文本内容

**type** `string` | 内容类型

`user.message.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`user.message.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`user.message.content.type`

内容类型，固定为 `image`

**source** `object` `必选` | 图片源

`user.message.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.message.content.source.media_type`

**data** `string` `必选` | Base64 数据

`user.message.content.source.data`

**URL 图片** `object`

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**url** `string` `必选` | 图片 URL

`user.message.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.message.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`user.message.content.type`

内容类型，固定为 `document`

**source** `object` `必选` | 文档源

`user.message.content.source`

文档源

**纯文本文档** `object`

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.message.content.source.media_type`

**data** `string` `必选` | 文本内容

`user.message.content.source.data`

**URL 文档** `object`

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**url** `string` `必选` | 文档 URL

`user.message.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.message.content.source.file_id`

**title** `string` | 文档标题

`user.message.content.title`

**context** `string` | 上下文说明

`user.message.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`user.message.content.type`

内容类型，固定为 `video`

**source** `object` `必选` | 视频源

`user.message.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.message.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` `必选` | Base64 数据

`user.message.content.source.data`

**fps** `number` | 抽帧频率

`user.message.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**url** `string` `必选` | 视频 URL

`user.message.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`user.message.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` `必选` | 内容类型

`user.message.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.message.content.source.file_id`

**fps** `number` | 抽帧频率

`user.message.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

---

### system.message

> 客户端向会话注入系统提示词时触发，必须作为同一 `events` 数组中 `user.message` 后的下一个事件发送

**type** `string` | 事件类型

`system.message.type`

事件类型，固定为 `system.message`

**id** `string` | 事件 ID

`system.message.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`system.message.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`system.message.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**content** `object[]` `必选` | 消息内容

`system.message.content`

系统提示词的文本内容，至少包含一个文本块

**文本** `object`

文本内容

**type** `string` | 内容类型

`system.message.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`system.message.content.text`

---

### user.interrupt

> 用户发送中断指令，终止正在运行的线程/会话时触发

**type** `string` | 事件类型

`user.interrupt.type`

事件类型，固定为 `user.interrupt`

**id** `string` | 事件 ID

`user.interrupt.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`user.interrupt.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`user.interrupt.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**session_thread_id** `string` | 线程 ID

`user.interrupt.session_thread_id`

要中断的线程 ID，不填则中断会话内所有活跃线程

---

### user.tool_confirmation

> 用户对需要确认的工具调用进行批准/拒绝操作时触发

**type** `string` | 事件类型

`user.tool_confirmation.type`

事件类型，固定为 `user.tool_confirmation`

**id** `string` | 事件 ID

`user.tool_confirmation.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`user.tool_confirmation.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`user.tool_confirmation.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**result** `string` `必选` | 确认结果

`user.tool_confirmation.result`

确认结果。`allow` 表示批准，`deny` 表示拒绝。

**tool_use_id** `string` `必选` | 工具调用 ID

`user.tool_confirmation.tool_use_id`

对应的工具调用事件 ID（`agent.tool_use` 或 `agent.mcp_tool_use`）。当 `stop_reason.type` 为 `requires_action` 时，从 `stop_reason.event_ids` 获取该 ID 并原样填入

**deny_message** `string` | 拒绝理由

`user.tool_confirmation.deny_message`

拒绝理由，仅当 `result` 为 `deny` 时有效。

**session_thread_id** `string` | 线程 ID

`user.tool_confirmation.session_thread_id`

所属线程 ID

---

### user.tool_result

> 自托管 Environment 中的 Worker 完成内置工具调用后，客户端回传执行结果时触发

**type** `string` | 事件类型

`user.tool_result.type`

事件类型，固定为 `user.tool_result`

**id** `string` | 事件 ID

`user.tool_result.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`user.tool_result.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`user.tool_result.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**tool_use_id** `string` `必选` | 工具调用 ID

`user.tool_result.tool_use_id`

对应的 `agent.tool_use` 事件 ID。当 `stop_reason.type` 为 `requires_action` 时，从 `stop_reason.event_ids` 获取该 ID 并原样填入

**content** `object[]` | 结果内容

`user.tool_result.content`

工具执行结果的多模态内容块列表，支持文本、图片、文档、视频和搜索结果

**文本** `object`

文本内容

**type** `string` | 内容类型

`user.tool_result.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`user.tool_result.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`user.tool_result.content.type`

内容类型，固定为 `image`

**source** `object` `必选` | 图片源

`user.tool_result.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.tool_result.content.source.media_type`

**data** `string` `必选` | Base64 数据

`user.tool_result.content.source.data`

**URL 图片** `object`

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**url** `string` `必选` | 图片 URL

`user.tool_result.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.tool_result.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`user.tool_result.content.type`

内容类型，固定为 `document`

**source** `object` `必选` | 文档源

`user.tool_result.content.source`

文档源

**纯文本文档** `object`

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.tool_result.content.source.media_type`

**data** `string` `必选` | 文本内容

`user.tool_result.content.source.data`

**URL 文档** `object`

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**url** `string` `必选` | 文档 URL

`user.tool_result.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.tool_result.content.source.file_id`

**title** `string` | 文档标题

`user.tool_result.content.title`

**context** `string` | 上下文说明

`user.tool_result.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`user.tool_result.content.type`

内容类型，固定为 `video`

**source** `object` `必选` | 视频源

`user.tool_result.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.tool_result.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` `必选` | Base64 数据

`user.tool_result.content.source.data`

**fps** `number` | 抽帧频率

`user.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**url** `string` `必选` | 视频 URL

`user.tool_result.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`user.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` `必选` | 内容类型

`user.tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.tool_result.content.source.file_id`

**fps** `number` | 抽帧频率

`user.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**搜索结果** `object`

**type** `string` | 内容类型

`user.tool_result.content.type`

内容类型，固定为 `search_result`

**source** `string` `必选` | 结果 URL

`user.tool_result.content.source`

**title** `string` `必选` | 结果标题

`user.tool_result.content.title`

**content** `object[]` `必选` | 结果内容

`user.tool_result.content.content`

搜索结果内容片段

**type** `string` `必选` | 内容类型

`user.tool_result.content.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`user.tool_result.content.content.text`

搜索结果文本片段

**citations** `object` `必选` | 引用配置

`user.tool_result.content.citations`

搜索结果引用配置

**enabled** `boolean` `必选` | 是否启用引用

`user.tool_result.content.citations.enabled`

是否启用引用标注

**is_error** `boolean` | 是否错误

`user.tool_result.is_error`

工具是否执行失败。设为 `true` 时，Agent 会收到失败结果及 `content` 中的错误信息，并继续后续处理

**session_thread_id** `string` | 线程 ID

`user.tool_result.session_thread_id`

触发工具调用的线程 ID。子线程触发工具调用时，将响应事件返回的 `session_thread_id` 原样填入

---

### user.custom_tool_result

> 客户端本地执行完自定义工具（`custom` 类型工具，如生图、生视频等场景）后回传结果时触发。通过 `custom_tool_use_id` 关联对应的 `agent.custom_tool_use` 事件。

**type** `string` | 事件类型

`user.custom_tool_result.type`

事件类型，固定为 `user.custom_tool_result`

**id** `string` | 事件 ID

`user.custom_tool_result.id`

事件唯一标识符。客户端无需填写；服务端生成形如 `sevt-...` 的 ID 后回填

**session_id** `string` | Session ID

`user.custom_tool_result.session_id`

目标 Session ID。请求路径已指定 Session 时可以省略

**processed_at** `string` | 处理时间

`user.custom_tool_result.processed_at`

事件处理时间，由服务端生成并写入事件历史，采用 RFC 3339 格式

**custom_tool_use_id** `string` `必选` | 自定义工具调用 ID

`user.custom_tool_result.custom_tool_use_id`

对应的自定义工具调用事件 ID（来自 `agent.custom_tool_use`）。当 `stop_reason.type` 为 `requires_action` 时，从 `stop_reason.event_ids` 获取该 ID 并原样填入

**content** `object[]` | 结果内容

`user.custom_tool_result.content`

工具执行结果的多模态内容块列表，字段结构以 `ToolResultContentBlock` 为准

**文本** `object`

文本内容

**type** `string` | 内容类型

`user.custom_tool_result.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`user.custom_tool_result.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`user.custom_tool_result.content.type`

内容类型，固定为 `image`

**source** `object` `必选` | 图片源

`user.custom_tool_result.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.custom_tool_result.content.source.media_type`

**data** `string` `必选` | Base64 数据

`user.custom_tool_result.content.source.data`

**URL 图片** `object`

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**url** `string` `必选` | 图片 URL

`user.custom_tool_result.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.custom_tool_result.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`user.custom_tool_result.content.type`

内容类型，固定为 `document`

**source** `object` `必选` | 文档源

`user.custom_tool_result.content.source`

文档源

**纯文本文档** `object`

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.custom_tool_result.content.source.media_type`

**data** `string` `必选` | 文本内容

`user.custom_tool_result.content.source.data`

**URL 文档** `object`

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**url** `string` `必选` | 文档 URL

`user.custom_tool_result.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.custom_tool_result.content.source.file_id`

**title** `string` | 文档标题

`user.custom_tool_result.content.title`

**context** `string` | 上下文说明

`user.custom_tool_result.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`user.custom_tool_result.content.type`

内容类型，固定为 `video`

**source** `object` `必选` | 视频源

`user.custom_tool_result.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**media_type** `string` `必选` | MIME 类型

`user.custom_tool_result.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` `必选` | Base64 数据

`user.custom_tool_result.content.source.data`

**fps** `number` | 抽帧频率

`user.custom_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**url** `string` `必选` | 视频 URL

`user.custom_tool_result.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`user.custom_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.source.type`

**file_id** `string` `必选` | 文件 ID

`user.custom_tool_result.content.source.file_id`

**fps** `number` | 抽帧频率

`user.custom_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**搜索结果** `object`

**type** `string` | 内容类型

`user.custom_tool_result.content.type`

内容类型，固定为 `search_result`

**source** `string` `必选` | 结果 URL

`user.custom_tool_result.content.source`

**title** `string` `必选` | 结果标题

`user.custom_tool_result.content.title`

**content** `object[]` `必选` | 结果内容

`user.custom_tool_result.content.content`

搜索结果内容片段

**type** `string` `必选` | 内容类型

`user.custom_tool_result.content.content.type`

内容类型，固定为 `text`

**text** `string` `必选` | 文本内容

`user.custom_tool_result.content.content.text`

搜索结果文本片段

**citations** `object` `必选` | 引用配置

`user.custom_tool_result.content.citations`

搜索结果引用配置

**enabled** `boolean` `必选` | 是否启用引用

`user.custom_tool_result.content.citations.enabled`

是否启用引用标注

**is_error** `boolean` | 是否错误

`user.custom_tool_result.is_error`

工具是否执行失败

**session_thread_id** `string` | 线程 ID

`user.custom_tool_result.session_thread_id`

触发工具调用的线程 ID。子线程触发工具调用时，将响应事件返回的 `session_thread_id` 原样填入

---

## 服务端推送事件（响应）

### agent.message

> 智能体生成回复消息时触发，包括最终回复以及工具调用前后的中间文本（随模型行为不同而不同）

**type** `string` | 事件类型

`agent.message.type`

事件类型，固定为 `agent.message`

**id** `string` | 事件 ID

`agent.message.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.message.processed_at`

事件处理时间，采用 RFC 3339 格式

**content** `object[]` | 回复内容

`agent.message.content`

回复内容，仅包含文本块

**type** `string` | 内容类型

`agent.message.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.message.content.text`

文本内容

---

### agent.thinking

> 智能体生成思考内容时触发

**type** `string` | 事件类型

`agent.thinking.type`

事件类型，固定为 `agent.thinking`

**id** `string` | 事件 ID

`agent.thinking.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.thinking.processed_at`

事件处理时间，采用 RFC 3339 格式

**content** `object[]` | 思考内容

`agent.thinking.content`

思考内容，仅包含文本块

**type** `string` | 内容类型

`agent.thinking.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.thinking.content.text`

文本内容

---

### agent.tool_use

> 智能体决定调用内置工具时触发

**type** `string` | 事件类型

`agent.tool_use.type`

事件类型，固定为 `agent.tool_use`

**id** `string` | 事件 ID

`agent.tool_use.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.tool_use.processed_at`

事件处理时间，采用 RFC 3339 格式

**name** `string` | 工具名称

`agent.tool_use.name`

工具名称

**input** `object` | 输入参数

`agent.tool_use.input`

工具输入参数，JSON 对象

**evaluated_permission** `string` | 权限结果

`agent.tool_use.evaluated_permission`

权限策略评估结果。`allow` 表示直接调用；`ask` 表示客户端需发送 `user.tool_confirmation`，确认前会话等待用户操作；`deny` 表示拒绝调用

**session_thread_id** `string` | 线程 ID

`agent.tool_use.session_thread_id`

工具调用所属线程 ID。子线程触发工具调用时可能返回该字段；回传 `user.tool_confirmation` 或 `user.tool_result` 时应原样带回

---

### agent.tool_result

> 内置工具执行完成并返回结果时触发

**type** `string` | 事件类型

`agent.tool_result.type`

事件类型，固定为 `agent.tool_result`

**id** `string` | 事件 ID

`agent.tool_result.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.tool_result.processed_at`

事件处理时间，采用 RFC 3339 格式

**tool_use_id** `string` | 工具调用 ID

`agent.tool_result.tool_use_id`

对应的工具调用事件 ID

**content** `object[]` | 结果内容

`agent.tool_result.content`

工具执行结果内容

**文本** `object`

文本内容

**type** `string` | 内容类型

`agent.tool_result.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.tool_result.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`agent.tool_result.content.type`

内容类型，固定为 `image`

**source** `object` | 图片源

`agent.tool_result.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.tool_result.content.source.media_type`

**data** `string` | Base64 数据

`agent.tool_result.content.source.data`

**URL 图片** `object`

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**url** `string` | 图片 URL

`agent.tool_result.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.tool_result.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`agent.tool_result.content.type`

内容类型，固定为 `document`

**source** `object` | 文档源

`agent.tool_result.content.source`

文档源

**纯文本文档** `object`

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.tool_result.content.source.media_type`

**data** `string` | 文本内容

`agent.tool_result.content.source.data`

**URL 文档** `object`

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**url** `string` | 文档 URL

`agent.tool_result.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.tool_result.content.source.file_id`

**title** `string` | 文档标题

`agent.tool_result.content.title`

**context** `string` | 上下文说明

`agent.tool_result.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`agent.tool_result.content.type`

内容类型，固定为 `video`

**source** `object` | 视频源

`agent.tool_result.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.tool_result.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` | Base64 数据

`agent.tool_result.content.source.data`

**fps** `number` | 抽帧频率

`agent.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**url** `string` | 视频 URL

`agent.tool_result.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`agent.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` | 内容类型

`agent.tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.tool_result.content.source.file_id`

**fps** `number` | 抽帧频率

`agent.tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**搜索结果** `object`

**type** `string` | 内容类型

`agent.tool_result.content.type`

内容类型，固定为 `search_result`

**source** `string` | 结果 URL

`agent.tool_result.content.source`

**title** `string` | 结果标题

`agent.tool_result.content.title`

**content** `object[]` | 结果内容

`agent.tool_result.content.content`

搜索结果内容片段

**type** `string` | 内容类型

`agent.tool_result.content.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.tool_result.content.content.text`

搜索结果文本片段

**citations** `object` | 引用配置

`agent.tool_result.content.citations`

搜索结果引用配置

**enabled** `boolean` | 是否启用引用

`agent.tool_result.content.citations.enabled`

是否启用引用标注

**is_error** `boolean` | 是否错误

`agent.tool_result.is_error`

执行是否出错

---

### agent.mcp_tool_use

> 智能体决定调用 MCP 服务提供的工具时触发

**type** `string` | 事件类型

`agent.mcp_tool_use.type`

事件类型，固定为 `agent.mcp_tool_use`

**id** `string` | 事件 ID

`agent.mcp_tool_use.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.mcp_tool_use.processed_at`

事件处理时间，采用 RFC 3339 格式

**mcp_server_name** `string` | MCP 服务名

`agent.mcp_tool_use.mcp_server_name`

MCP 服务名称

**name** `string` | 工具名称

`agent.mcp_tool_use.name`

工具名称

**input** `object` | 输入参数

`agent.mcp_tool_use.input`

工具输入参数，JSON 对象

**evaluated_permission** `string` | 权限结果

`agent.mcp_tool_use.evaluated_permission`

权限策略评估结果。`allow` 表示直接调用；`ask` 表示客户端需发送 `user.tool_confirmation`，确认前会话等待用户操作；`deny` 表示拒绝调用

**session_thread_id** `string` | 线程 ID

`agent.mcp_tool_use.session_thread_id`

工具调用所属线程 ID。子线程触发工具调用时可能返回该字段；回传 `user.tool_confirmation` 时应原样带回

---

### agent.mcp_tool_result

> MCP 工具执行完成并返回结果时触发

**type** `string` | 事件类型

`agent.mcp_tool_result.type`

事件类型，固定为 `agent.mcp_tool_result`

**id** `string` | 事件 ID

`agent.mcp_tool_result.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.mcp_tool_result.processed_at`

事件处理时间，采用 RFC 3339 格式

**mcp_tool_use_id** `string` | MCP 工具调用 ID

`agent.mcp_tool_result.mcp_tool_use_id`

对应的 MCP 工具调用事件 ID

**content** `object[]` | 结果内容

`agent.mcp_tool_result.content`

工具执行结果内容

**文本** `object`

文本内容

**type** `string` | 内容类型

`agent.mcp_tool_result.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.mcp_tool_result.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`agent.mcp_tool_result.content.type`

内容类型，固定为 `image`

**source** `object` | 图片源

`agent.mcp_tool_result.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.mcp_tool_result.content.source.media_type`

**data** `string` | Base64 数据

`agent.mcp_tool_result.content.source.data`

**URL 图片** `object`

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**url** `string` | 图片 URL

`agent.mcp_tool_result.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.mcp_tool_result.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`agent.mcp_tool_result.content.type`

内容类型，固定为 `document`

**source** `object` | 文档源

`agent.mcp_tool_result.content.source`

文档源

**纯文本文档** `object`

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.mcp_tool_result.content.source.media_type`

**data** `string` | 文本内容

`agent.mcp_tool_result.content.source.data`

**URL 文档** `object`

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**url** `string` | 文档 URL

`agent.mcp_tool_result.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.mcp_tool_result.content.source.file_id`

**title** `string` | 文档标题

`agent.mcp_tool_result.content.title`

**context** `string` | 上下文说明

`agent.mcp_tool_result.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`agent.mcp_tool_result.content.type`

内容类型，固定为 `video`

**source** `object` | 视频源

`agent.mcp_tool_result.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**media_type** `string` | MIME 类型

`agent.mcp_tool_result.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` | Base64 数据

`agent.mcp_tool_result.content.source.data`

**fps** `number` | 抽帧频率

`agent.mcp_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**url** `string` | 视频 URL

`agent.mcp_tool_result.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`agent.mcp_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` | 内容类型

`agent.mcp_tool_result.content.source.type`

**file_id** `string` | 文件 ID

`agent.mcp_tool_result.content.source.file_id`

**fps** `number` | 抽帧频率

`agent.mcp_tool_result.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**搜索结果** `object`

**type** `string` | 内容类型

`agent.mcp_tool_result.content.type`

内容类型，固定为 `search_result`

**source** `string` | 结果 URL

`agent.mcp_tool_result.content.source`

**title** `string` | 结果标题

`agent.mcp_tool_result.content.title`

**content** `object[]` | 结果内容

`agent.mcp_tool_result.content.content`

搜索结果内容片段

**type** `string` | 内容类型

`agent.mcp_tool_result.content.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.mcp_tool_result.content.content.text`

搜索结果文本片段

**citations** `object` | 引用配置

`agent.mcp_tool_result.content.citations`

搜索结果引用配置

**enabled** `boolean` | 是否启用引用

`agent.mcp_tool_result.content.citations.enabled`

是否启用引用标注

**is_error** `boolean` | 是否错误

`agent.mcp_tool_result.is_error`

执行是否出错

---

### agent.custom_tool_use

> 智能体决定调用客户端提供的自定义工具（`custom` 类型工具，如生图、生视频等场景）时触发。客户端执行工具后，通过 `user.custom_tool_result` 回传结果；`custom_tool_use_id` 需与本事件 `id` 一一匹配。

**type** `string` | 事件类型

`agent.custom_tool_use.type`

事件类型，固定为 `agent.custom_tool_use`

**id** `string` | 事件 ID

`agent.custom_tool_use.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.custom_tool_use.processed_at`

事件处理时间，采用 RFC 3339 格式

**name** `string` | 工具名称

`agent.custom_tool_use.name`

自定义工具名称，对应 Agent 配置中 `custom` 类型工具项的 `name`

**input** `object` | 输入参数

`agent.custom_tool_use.input`

工具输入参数，JSON 对象

**session_thread_id** `string` | 线程 ID

`agent.custom_tool_use.session_thread_id`

工具调用所属线程 ID。子线程触发工具调用时可能返回该字段；回传 `user.custom_tool_result` 时应原样带回

---

### agent.thread_message_received

> 多智能体场景下，当前线程收到其他线程/智能体发来的消息时触发

**type** `string` | 事件类型

`agent.thread_message_received.type`

事件类型，固定为 `agent.thread_message_received`

**id** `string` | 事件 ID

`agent.thread_message_received.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.thread_message_received.processed_at`

事件处理时间，采用 RFC 3339 格式

**content** `object[]` | 消息内容

`agent.thread_message_received.content`

收到的消息内容

**文本** `object`

文本内容

**type** `string` | 内容类型

`agent.thread_message_received.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.thread_message_received.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`agent.thread_message_received.content.type`

内容类型，固定为 `image`

**source** `object` | 图片源

`agent.thread_message_received.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_received.content.source.media_type`

**data** `string` | Base64 数据

`agent.thread_message_received.content.source.data`

**URL 图片** `object`

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**url** `string` | 图片 URL

`agent.thread_message_received.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_received.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`agent.thread_message_received.content.type`

内容类型，固定为 `document`

**source** `object` | 文档源

`agent.thread_message_received.content.source`

文档源

**纯文本文档** `object`

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_received.content.source.media_type`

**data** `string` | 文本内容

`agent.thread_message_received.content.source.data`

**URL 文档** `object`

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**url** `string` | 文档 URL

`agent.thread_message_received.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_received.content.source.file_id`

**title** `string` | 文档标题

`agent.thread_message_received.content.title`

**context** `string` | 上下文说明

`agent.thread_message_received.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`agent.thread_message_received.content.type`

内容类型，固定为 `video`

**source** `object` | 视频源

`agent.thread_message_received.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_received.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` | Base64 数据

`agent.thread_message_received.content.source.data`

**fps** `number` | 抽帧频率

`agent.thread_message_received.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**url** `string` | 视频 URL

`agent.thread_message_received.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`agent.thread_message_received.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` | 内容类型

`agent.thread_message_received.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_received.content.source.file_id`

**fps** `number` | 抽帧频率

`agent.thread_message_received.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**from_session_thread_id** `string` | 来源线程 ID

`agent.thread_message_received.from_session_thread_id`

消息来源线程 ID

**from_agent_name** `string` | 来源智能体名称

`agent.thread_message_received.from_agent_name`

发送方智能体名称，来自主智能体时为空

---

### agent.thread_message_sent

> 多智能体场景下，当前线程向其他线程/智能体发送消息时触发

**type** `string` | 事件类型

`agent.thread_message_sent.type`

事件类型，固定为 `agent.thread_message_sent`

**id** `string` | 事件 ID

`agent.thread_message_sent.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.thread_message_sent.processed_at`

事件处理时间，采用 RFC 3339 格式

**content** `object[]` | 消息内容

`agent.thread_message_sent.content`

发送的消息内容

**文本** `object`

文本内容

**type** `string` | 内容类型

`agent.thread_message_sent.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`agent.thread_message_sent.content.text`

**图片** `object`

图片内容

**type** `string` | 内容类型

`agent.thread_message_sent.content.type`

内容类型，固定为 `image`

**source** `object` | 图片源

`agent.thread_message_sent.content.source`

**Base64 图片** `object`

Base64 编码图片

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_sent.content.source.media_type`

**data** `string` | Base64 数据

`agent.thread_message_sent.content.source.data`

**URL 图片** `object`

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**url** `string` | 图片 URL

`agent.thread_message_sent.content.source.url`

**文件图片** `object`

文件 ID 图片

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_sent.content.source.file_id`

**文档** `object`

文档内容

**type** `string` | 内容类型

`agent.thread_message_sent.content.type`

内容类型，固定为 `document`

**source** `object` | 文档源

`agent.thread_message_sent.content.source`

文档源

**纯文本文档** `object`

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_sent.content.source.media_type`

**data** `string` | 文本内容

`agent.thread_message_sent.content.source.data`

**URL 文档** `object`

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**url** `string` | 文档 URL

`agent.thread_message_sent.content.source.url`

**文件文档** `object`

文件 ID 文档

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_sent.content.source.file_id`

**title** `string` | 文档标题

`agent.thread_message_sent.content.title`

**context** `string` | 上下文说明

`agent.thread_message_sent.content.context`

**视频** `object`

视频内容

**type** `string` | 内容类型

`agent.thread_message_sent.content.type`

内容类型，固定为 `video`

**source** `object` | 视频源

`agent.thread_message_sent.content.source`

视频源

**Base64 视频** `object`

Base64 编码视频

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**media_type** `string` | MIME 类型

`agent.thread_message_sent.content.source.media_type`

取值：`video/mp4` / `video/x-msvideo` / `video/quicktime`。

**data** `string` | Base64 数据

`agent.thread_message_sent.content.source.data`

**fps** `number` | 抽帧频率

`agent.thread_message_sent.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**URL 视频** `object`

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**url** `string` | 视频 URL

`agent.thread_message_sent.content.source.url`

公网可访问的视频 URL，可处理的视频大小以下游模型的输入限制为准；对象存储需将 `Content-Type` 设置为对应视频 MIME 类型

**fps** `number` | 抽帧频率

`agent.thread_message_sent.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**文件视频** `object`

文件 ID 视频

**type** `string` | 内容类型

`agent.thread_message_sent.content.source.type`

**file_id** `string` | 文件 ID

`agent.thread_message_sent.content.source.file_id`

**fps** `number` | 抽帧频率

`agent.thread_message_sent.content.source.fps`

抽帧频率，取值范围为 0.2 到 5；省略时使用下游模型的默认策略

**to_session_thread_id** `string` | 目标线程 ID

`agent.thread_message_sent.to_session_thread_id`

消息目标线程 ID

**to_agent_name** `string` | 目标智能体名称

`agent.thread_message_sent.to_agent_name`

接收方智能体名称，发给主智能体时为空

---

### agent.thread_context_compacted

> 线程上下文达到长度限制，自动进行摘要压缩时触发

**type** `string` | 事件类型

`agent.thread_context_compacted.type`

事件类型，固定为 `agent.thread_context_compacted`

**id** `string` | 事件 ID

`agent.thread_context_compacted.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`agent.thread_context_compacted.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### session.error

> 会话执行过程中发生错误时触发

**type** `string` | 事件类型

`session.error.type`

事件类型，固定为 `session.error`

**id** `string` | 事件 ID

`session.error.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.error.processed_at`

事件处理时间，采用 RFC 3339 格式

**error** `object` | 错误详情

`session.error.error`

错误详情，支持多态错误类型

**未知错误** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**模型过载** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**模型限流** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**请求失败** `object`

模型请求失败

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**MCP 连接失败** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**mcp_server_name** `string` | MCP 服务名

`session.error.error.mcp_server_name`

**MCP 认证失败** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**mcp_server_name** `string` | MCP 服务名

`session.error.error.mcp_server_name`

**计费错误** `object`

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**凭证不可达** `object`

凭证服务不可达

**type** `string` | 错误类型

`session.error.error.type`

**message** `string` | 错误信息

`session.error.error.message`

**retry_status** `object` | 重试状态

`session.error.error.retry_status`

重试状态

**重试中** `object`

服务端正在自动重试，客户端应等待

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `retrying`，表示服务端正在自动重试

**重试耗尽** `object`

当前轮次结束，会话恢复为空闲状态后可继续发送输入

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `exhausted`，表示已用尽当前轮次重试次数

**终止** `object`

会话将进入终止状态，客户端不能继续发送事件

**type** `string` | 状态类型

`session.error.error.retry_status.type`

状态类型，固定为 `terminal`，表示会话将进入终止状态

**vault_id** `string` | 保管库 ID

`session.error.error.vault_id`

**credential_id** `string` | 凭证 ID

`session.error.error.credential_id`

---

### session.deleted

> 会话被删除时触发。收到该事件后，该会话不会再产生后续事件，客户端应结束当前流式连接

**type** `string` | 事件类型

`session.deleted.type`

事件类型，固定为 `session.deleted`

**id** `string` | 事件 ID

`session.deleted.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.deleted.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### session.thread_created

> 多智能体会话中新线程创建成功时触发。订阅父线程时也可能收到该通知；子线程内部消息需订阅对应线程

**type** `string` | 事件类型

`session.thread_created.type`

事件类型，固定为 `session.thread_created`

**id** `string` | 事件 ID

`session.thread_created.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.thread_created.processed_at`

事件处理时间，采用 RFC 3339 格式

**agent_name** `string` | 智能体名称

`session.thread_created.agent_name`

线程所属智能体名称

**session_thread_id** `string` | 线程 ID

`session.thread_created.session_thread_id`

新创建的线程 ID

---

### session.status_running

> 会话开始处理任务，进入运行状态时触发

**type** `string` | 事件类型

`session.status_running.type`

事件类型，固定为 `session.status_running`

**id** `string` | 事件 ID

`session.status_running.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.status_running.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### session.status_idle

> 会话处理完当前任务，进入空闲状态时触发

**type** `string` | 事件类型

`session.status_idle.type`

事件类型，固定为 `session.status_idle`

**id** `string` | 事件 ID

`session.status_idle.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.status_idle.processed_at`

事件处理时间，采用 RFC 3339 格式

**stop_reason** `object` | 停止原因

`session.status_idle.stop_reason`

停止原因，支持多态类型

**正常结束** `object`

当前轮次正常结束，客户端可以发送下一条消息

**type** `string` | 停止原因类型

`session.status_idle.stop_reason.type`

**需要操作** `object`

需要用户操作

**type** `string` | 停止原因类型

`session.status_idle.stop_reason.type`

**event_ids** `string[]` | 待处理事件 ID 列表

`session.status_idle.stop_reason.event_ids`

待处理的工具调用事件 ID 列表。客户端处理对应操作后，将 ID 原样填入确认或结果事件

**重试耗尽** `object`

已用尽当前轮次重试次数，仅结束当前轮次；会话恢复为空闲状态后仍可继续发送输入

**type** `string` | 停止原因类型

`session.status_idle.stop_reason.type`

---

### session.status_rescheduled

> 会话因临时错误进入自动恢复和重新调度过程时触发

**type** `string` | 事件类型

`session.status_rescheduled.type`

事件类型，固定为 `session.status_rescheduled`

**id** `string` | 事件 ID

`session.status_rescheduled.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.status_rescheduled.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### session.status_terminated

> 会话进入终态时触发。该状态下不能继续发送事件；`retries_exhausted` 仅表示当前轮次结束，不代表会话终止

**type** `string` | 事件类型

`session.status_terminated.type`

事件类型，固定为 `session.status_terminated`

**id** `string` | 事件 ID

`session.status_terminated.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.status_terminated.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### session.thread_status_running

> 线程开始处理任务，进入运行状态时触发

**type** `string` | 事件类型

`session.thread_status_running.type`

事件类型，固定为 `session.thread_status_running`

**id** `string` | 事件 ID

`session.thread_status_running.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.thread_status_running.processed_at`

事件处理时间，采用 RFC 3339 格式

**agent_name** `string` | 智能体名称

`session.thread_status_running.agent_name`

线程所属智能体名称

**session_thread_id** `string` | 线程 ID

`session.thread_status_running.session_thread_id`

线程 ID

---

### session.thread_status_idle

> 线程处理完当前任务，进入空闲状态时触发

**type** `string` | 事件类型

`session.thread_status_idle.type`

事件类型，固定为 `session.thread_status_idle`

**id** `string` | 事件 ID

`session.thread_status_idle.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.thread_status_idle.processed_at`

事件处理时间，采用 RFC 3339 格式

**agent_name** `string` | 智能体名称

`session.thread_status_idle.agent_name`

线程所属智能体名称

**session_thread_id** `string` | 线程 ID

`session.thread_status_idle.session_thread_id`

线程 ID

**stop_reason** `object` | 停止原因

`session.thread_status_idle.stop_reason`

停止原因，支持多态类型

**正常结束** `object`

当前轮次正常结束，客户端可以发送下一条消息

**type** `string` | 停止原因类型

`session.thread_status_idle.stop_reason.type`

**需要操作** `object`

需要用户操作

**type** `string` | 停止原因类型

`session.thread_status_idle.stop_reason.type`

**event_ids** `string[]` | 待处理事件 ID 列表

`session.thread_status_idle.stop_reason.event_ids`

待处理的工具调用事件 ID 列表。客户端处理对应操作后，将 ID 原样填入确认或结果事件

**重试耗尽** `object`

已用尽当前轮次重试次数，仅结束当前轮次；会话恢复为空闲状态后仍可继续发送输入

**type** `string` | 停止原因类型

`session.thread_status_idle.stop_reason.type`

---

### session.thread_status_rescheduled

> 线程因临时错误进入自动恢复和重新调度过程时触发。订阅父线程时也可能收到子线程的该状态通知

**type** `string` | 事件类型

`session.thread_status_rescheduled.type`

事件类型，固定为 `session.thread_status_rescheduled`

**id** `string` | 事件 ID

`session.thread_status_rescheduled.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.thread_status_rescheduled.processed_at`

事件处理时间，采用 RFC 3339 格式

**agent_name** `string` | 智能体名称

`session.thread_status_rescheduled.agent_name`

线程所属智能体名称

**session_thread_id** `string` | 线程 ID

`session.thread_status_rescheduled.session_thread_id`

线程 ID

---

### session.thread_status_terminated

> 线程被终止时触发。订阅父线程时也可能收到子线程的该状态通知

**type** `string` | 事件类型

`session.thread_status_terminated.type`

事件类型，固定为 `session.thread_status_terminated`

**id** `string` | 事件 ID

`session.thread_status_terminated.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`session.thread_status_terminated.processed_at`

事件处理时间，采用 RFC 3339 格式

**agent_name** `string` | 智能体名称

`session.thread_status_terminated.agent_name`

线程所属智能体名称

**session_thread_id** `string` | 线程 ID

`session.thread_status_terminated.session_thread_id`

线程 ID

---

### span.model_request_start

> 开始调用大模型时触发，用于链路追踪

**type** `string` | 事件类型

`span.model_request_start.type`

事件类型，固定为 `span.model_request_start`

**id** `string` | 事件 ID

`span.model_request_start.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`span.model_request_start.processed_at`

事件处理时间，采用 RFC 3339 格式

---

### span.model_request_end

> 大模型调用完成时触发

**type** `string` | 事件类型

`span.model_request_end.type`

事件类型，固定为 `span.model_request_end`

**id** `string` | 事件 ID

`span.model_request_end.id`

事件唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 处理时间

`span.model_request_end.processed_at`

事件处理时间，采用 RFC 3339 格式

**model_request_start_id** `string` | 开始事件 ID

`span.model_request_end.model_request_start_id`

对应的模型请求开始事件 ID

**model_usage** `object` | token 用量

`span.model_request_end.model_usage`

模型 token 用量统计

**cache_creation_input_tokens** `integer` | 缓存写入 token

`span.model_request_end.model_usage.cache_creation_input_tokens`

缓存写入的输入 token 数

**cache_read_input_tokens** `integer` | 缓存读取 token

`span.model_request_end.model_usage.cache_read_input_tokens`

缓存命中读取的输入 token 数

**input_tokens** `integer` | 输入 token

`span.model_request_end.model_usage.input_tokens`

输入 token 总数

**output_tokens** `integer` | 输出 token

`span.model_request_end.model_usage.output_tokens`

输出 token 总数

**speed** `string` | 速度档位

`span.model_request_end.model_usage.speed`

推理速度档位。取值：`standard` / `fast`。

**is_error** `boolean` | 是否错误

`span.model_request_end.is_error`

模型调用是否出错

---

## 流式预览帧（SSE）

### event_start

> 通过 `event_deltas` 订阅 `agent.message` 或 `agent.thinking` 的增量预览后，服务端开始推送对应事件时触发

**type** `string` | 帧类型

`event_start.type`

帧类型，固定为 `event_start`

**id** `string` | 预览帧 ID

`event_start.id`

预览帧唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 生成时间

`event_start.processed_at`

预览帧生成时间，采用 RFC 3339 格式

**event** `object` | 预览事件

`event_start.event`

被预览事件的类型和 ID

**回复消息预览** `object`

Agent 回复消息预览

**type** `string` | 事件类型

`event_start.event.type`

事件类型，固定为 `agent.message`

**id** `string` | 事件 ID

`event_start.event.id`

被预览事件的 ID

**思考内容预览** `object`

Agent 思考内容预览

**type** `string` | 事件类型

`event_start.event.type`

事件类型，固定为 `agent.thinking`

**id** `string` | 事件 ID

`event_start.event.id`

被预览事件的 ID

---

### event_delta

> 被订阅事件生成新的文本片段时触发，客户端按 `event_id` 和 `index` 累积内容

**type** `string` | 帧类型

`event_delta.type`

帧类型，固定为 `event_delta`

**id** `string` | 预览帧 ID

`event_delta.id`

预览帧唯一标识符，形如 `sevt-...`，由服务端生成

**processed_at** `string` | 生成时间

`event_delta.processed_at`

预览帧生成时间，采用 RFC 3339 格式

**event_id** `string` | 事件 ID

`event_delta.event_id`

被预览事件的 ID，与对应 `event_start.event.id` 及最终 buffered 事件的 `id` 一致

**delta** `object` | 内容增量

`event_delta.delta`

当前内容增量

**type** `string` | 增量类型

`event_delta.delta.type`

增量类型，固定为 `content_delta`

**content** `object` | 文本片段

`event_delta.delta.content`

新增的文本片段

**type** `string` | 内容类型

`event_delta.delta.content.type`

内容类型，固定为 `text`

**text** `string` | 文本内容

`event_delta.delta.content.text`

文本内容

**index** `integer` | 内容下标

`event_delta.delta.index`

文本片段在最终 `content[]` 数组中的下标

---
