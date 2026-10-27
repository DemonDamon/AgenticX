---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/event-post
fetched: 2026-10-23
title: 发送 Event
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 发送 Event

> 向会话写入事件：用户消息、中断、工具审批、回填函数结果。请求体顶层只有 input，为事件数组（长度 1-50）。

<meta property="og:title" content="发送 Event" />

## 前提 <span id="h-ep-prereq" />

已创建会话，详见[创建 Session](session-create.md)。

## 接口 <span id="h-ep-endpoint" />

<strong>POST</strong> `/sessions/{session_id}/events`

请求体顶层只有一个字段 `input`，为事件数组（长度 1-50）。每个事件至少含 `role` 与 `type`。

## 请求体结构 <span id="h-ep-shape" />

```json
{
  "input": [
    { "role": "user", "type": "message", "content": [...] }
  ]
}
```

## 客户端事件类型 <span id="h-ep-types" />

| type                     | role   | 用途与关键字段                                                                                                                                                                                 |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`                | `user` | 发送用户消息，触发智能体进入 `running`。必填 `content`（数组）                                                                                                                                               |
| `interrupt`              | `user` | 中断当前轮处理，会话回到 `idle`。可选顶层 `session_thread_id`（多 agent 时定向中断子线程）                                                                                                                          |
| `tool_approval_response` | `user` | 回应工具审批。`content` 为单个 `data` 块，`data` 内必填 `batch_id`、`call_id`、`result`（`allow` / `deny`），可选 `deny_message`（仅 `deny` 时作为工具输出回传给模型）。同一次请求内的多条 `tool_approval_response` 必须属于同一个 `batch_id` |
| `function_call_output`   | `tool` | 回填自托管函数执行结果。`content` 为单个 `data` 块，`data` 内必填 `call_id` 与 `output`（字符串）；可选顶层 `is_error`、`session_thread_id`                                                                             |
| `tool_call_output`       | `tool` | 回填自托管平台内置工具的执行结果，结构同 `function_call_output`（`content` 含 `call_id` + `output`，顶层可选 `is_error`、`session_thread_id`）                                                                       |

`interrupt` 与普通 `message` 可在同一请求混发，语义为：先结束当前审批批次，再开始聊天。

<Note>`tool_approval_response` 的 `batch_id` 与 `call_id` 共同标识一次审批（复合身份，且均非空），不能只按 `call_id` 匹配，也不得按 `call_id` 做会话级去重。工具审批仅支持主智能体，不支持在子智能体中使用。</Note>

## ContentBlock：消息内容 <span id="h-ep-cb" />

`content` 是 ContentBlock 数组。每个块按 `type` 区分，必须严格选其中一种载体。

| type      | 互斥字段                               | 说明                                                                                              |
| --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `text`    | `text`                             | 纯文本                                                                                             |
| `image`   | `image_url` / `file_id`（二选一）       | 图片，进入模型视觉通道：公网 URL 或已上传文件 ID（解引用为临时 URL，仅本轮渲染、不持久化）                                             |
| `video`   | `video_url` / `file_id`（二选一）       | 视频，进入模型视觉通道：公网 URL 或已上传文件 ID                                                                    |
| `audio`   | `data` + `format` / `file_id`（二选一） | 音频：仅出现在服务端推送/响应中（作为工具输出附件），不能作为客户端输入发送                                                          |
| `file`    | `file_id` + `filename`             | 文件：已上传文件 ID，需携带 `filename`（用于沙箱路径与文件清单）。**不支持 base64 输入**。文件由平台物化到会话沙箱，模型按需读取。`file_id` 为持久化真相源 |
| `data`    | `data`（object）                     | 结构化数据（JSON）。服务端状态事件也用此承载                                                                        |
| `refusal` | `refusal`                          | 模型拒绝信息，仅出现在服务端推送中                                                                               |

## 示例：发送文本消息 <span id="h-ep-eg-msg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions/sesn_01K8ZQX3/events" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "input": [
        {
          "role": "user",
          "type": "message",
          "content": [
            {"type": "text", "text": "分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势"}
          ]
        }
      ]
    }'
  ```

  ```python
  client.sessions.events.send(
      "sesn_01K8ZQX3",
      events=[user_message("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")],
  )
  ```

  ```java
  client.sessions().events().send("sesn_01K8ZQX3",
      Collections.singletonList(
          ClientEvents.userMessage("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")));
  ```
</CodeGroup>

## 响应 <span id="h-ep-resp" />

`200 OK` 返回写入成功的事件回显与请求 ID：

```json
{
  "data": [
    {
      "object": "message",
      "id": "msg_8f2a1c...",
      "created_at": "2025-10-24T08:15:30.123Z",
      "role": "user",
      "type": "message",
      "status": "completed",
      "content": [{"type": "text", "text": "..."}]
    }
  ],
  "request_id": "req_01K8ZQX..."
}
```

<Note>200 仅表示事件入队成功，**不代表** agent 已开始处理或裁决已生效——尤其对 `tool_approval_response`，事件被受理不等于审批已裁决生效。实际处理结果需通过 SSE 事件流或后续 GET `/events` 观察。</Note>

### 响应字段 <span id="h-ep-dto" />

| 字段                  | 类型             | 说明                                                                                                                           |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `data`              | array\<object> | 已受理事件的回显数组，与请求 `input` 顺序对齐；回显仅表示入队成功，不代表已被处理或裁决已生效                                                                          |
| `data[].object`     | string         | 对象类型，固定为 `message`                                                                                                           |
| `data[].id`         | string         | 服务端分配的消息 ID，格式 `msg_<ULID>`                                                                                            |
| `data[].created_at` | string         | 服务端写入时间，ISO 8601                                                                                                             |
| `data[].role`       | string         | 事件角色，回显请求中的 `user`                                                                                                           |
| `data[].type`       | string         | 事件类型，回显请求中所发事件的 `type`（如发送 `message` 则回显 `message`，发送 `tool_approval_response` 则回显 `tool_approval_response`），并非固定为 `message` |
| `data[].status`     | string         | 写入状态，固定为 `completed`                                                                                                         |
| `data[].content`    | array\<object> | ContentBlock 数组，结构同请求                                                                                                        |
| `request_id`        | string         | 本次请求的唯一标识                                                                                                                    |
