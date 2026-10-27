---
source: https://ark.volcengine.com/region:cn-beijing/docs/managed-agent-custom-tool-tutorial
fetched: 2026-10-24
title: \[基础\] Custom Tool 使用教程
---

# [基础] Custom Tool 使用教程

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

Managed Agent（MA）支持内置工具、Custom Tool 和 MCP 工具。工具类型和基础配置请参见 [Tools](../tools.md)。

内置工具适合在托管 sandbox 中执行文件读写、命令执行、网页检索等操作；Custom Tool 适合将少量业务函数交给 Agent 调用；MCP 工具适合接入已经按 MCP 协议封装的外部能力。

在企业应用中，开发者通常还需要让 Agent 调用业务系统中的专用操作，例如查询订单、创建工单、调用库存系统、访问内网风控接口，或触发企业已有的图像、视频、数据处理服务。如果这些能力都通过 MCP server 接入，需要额外部署服务、维护 HTTP endpoint 和鉴权链路；如果让 Agent 直接通过命令行调用内部接口，则缺少稳定的参数 schema、权限边界和结果格式约束。

Custom Tool 用于解决这类“将少量业务函数交给 Agent 调用”的场景。开发者只需要在 Agent 中声明工具名称、用途和输入 schema，运行时由业务侧接收工具调用事件、执行真实业务逻辑，并将工具结果回传给 Session。Agent 可以基于工具结果继续推理和回复用户。

本文先通过订单查询演示可直接执行的最小事件闭环，再通过 4 个多媒体示例说明如何声明工具、触发调用和回传结果：

- 查询订单并回传确定性结果
- Custom Tool 生图
- 多图 Base64 回传
- 使用 File ID 作为参考素材生视频
- 查询视频任务并理解视频内容

## 前提条件

你需要准备：

- 已开通 Managed Agent，并已获取可用的 API Key。
- 已准备 Agent 使用的模型。
- 已创建云环境，并将其 ID 配置到 `ENVIRONMENT_ID`。
- 本地已安装 `curl` 7.76.0 或更高版本，以及 `jq`。
- 已明确需要暴露给 Agent 的业务操作，包括操作名称、用途、输入参数、返回结果和错误处理方式。
- 已准备业务侧执行逻辑。该逻辑可以运行在你的服务端、内部系统或任务队列中，用于接收工具调用事件、执行实际操作，并向 Session 回传工具结果。
- 如果工具需要访问内部系统，请提前配置鉴权、权限控制、审计日志和超时策略。

## 使用流程

使用 Custom Tool 的一般流程如下：

1. **声明工具**：创建 Agent 时，在 `tools` 中添加 `type: custom` 的工具，填写 `name`、`description` 和 `input_schema`。
2. **创建 Session**：基于该 Agent 创建 Session。
3. **建立事件流**：订阅 Session SSE，并等待服务端返回 `: ready`。
4. **发送用户消息**：向 Session 发送 `user.message`。
5. **接收工具调用事件**：当 Agent 判断需要调用自定义工具时，Session 事件流中会出现 `agent.custom_tool_use` 事件。该事件包含工具名称、工具输入参数和事件 ID。
6. **等待 Session 暂停**：Session 随后进入 `idle`，并发出 `session.status_idle` 事件。该事件的 `stop_reason.type` 为 `requires_action`，`stop_reason.event_ids` 中包含需要业务侧处理的事件 ID。
7. **执行业务逻辑**：业务侧根据 `agent.custom_tool_use` 的 `name` 和 `input` 执行对应操作。
8. **回传工具结果**：业务侧发送 `user.custom_tool_result` 事件，使用 `custom_tool_use_id` 关联第 5 步中的工具调用事件 ID。
9. **继续运行**：所有阻塞事件处理完成后，Session 从 `idle` 切回 `running`。业务侧继续监听，直到收到 `session.status_idle` 且 `stop_reason.type=end_turn`。

如果 `stop_reason.event_ids` 中包含多个事件 ID，需要为每个阻塞事件回传结果。建议将同一轮阻塞事件对应的多个 `user.custom_tool_result` 放在同一个 `events` 数组中发送。

## 声明自定义工具

自定义工具通过 Agent 的 `tools` 字段声明。每个工具至少包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | String | 固定为 `custom`。 |
| `name` | String | 工具名称。建议使用英文字母、数字、下划线或连字符，便于模型稳定引用。 |
| `description` | String | 工具用途、适用条件和限制。模型会根据该描述判断何时调用工具。 |
| `input_schema` | Object | 定义模型生成工具入参时参考的 JSON Schema。 |

声明工具时，建议遵循以下原则：

- `description` 明确说明工具应该在什么场景下使用，以及不应该在什么场景下使用。
- `input_schema` 只暴露业务必要参数，不暴露 API Key、内部服务地址等敏感配置。
- 对枚举值、数字范围、必填字段和 `additionalProperties` 做明确约束。
- 工具返回值保持结构化，便于 Agent 判断是否成功、是否需要重试，以及如何向用户解释结果。

以下示例显式关闭内置工具集，避免主 Agent 在只配置自定义工具时回退启用全部内置工具。响应示例仅展示与流程相关的关键字段，实际响应字段以 API 返回为准。

```Bash
AGENT_RESPONSE=$(curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/agents" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CustomToolDemo",
    "model": {
      "id": "doubao-seed-2-1-pro-260915"
    },
    "system": "你是一个可以调用业务工具的助手。需要外部业务能力时，调用已声明的自定义工具。不要编造工具结果。",
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "default_config": {
          "enabled": false,
          "permission_policy": {
            "type": "always_allow"
          }
        }
      },
      {
        "type": "custom",
        "name": "query_order",
        "description": "根据订单 ID 查询订单状态。仅当用户要求查询订单信息时使用。",
        "input_schema": {
          "type": "object",
          "properties": {
            "order_id": {
              "type": "string",
              "description": "订单 ID。"
            }
          },
          "required": ["order_id"],
          "additionalProperties": false
        }
      }
    ]
  }') || exit 1

jq . <<<"$AGENT_RESPONSE" || exit 1
AGENT_ID=$(jq -er '.id' <<<"$AGENT_RESPONSE") || exit 1
export AGENT_ID
printf 'Agent ID: %s\n' "$AGENT_ID"
```

响应示例：

```
{
  "id": "agent-20260729153010-****",
  "object": "agent",
  "created_at": "2026-07-29T15:30:10Z",
  "name": "CustomToolDemo",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  }
}
```

## 创建 Session

```bash
SESSION_RESPONSE=$(curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENVIRONMENT_ID"'",
    "title": "Custom Tool 演示"
  }')

SESSION_ID=$(jq -er '.id' <<<"$SESSION_RESPONSE")
export SESSION_ID
printf 'Session ID: %s\n' "$SESSION_ID"
```

响应示例：

```
{
  "id": "sesn-20260729153122-****",
  "object": "session",
  "agent": "agent-20260729153010-****",
  "environment_id": "env-20260729152900-****",
  "status": "idle"
}
```

<span id="run-minimal-loop"></span>
## 运行最小可执行闭环

以下函数从空 Session 开始完成一次 `query_order` 调用。函数先建立 SSE 并等待 `: ready`，再发送消息；收到 `requires_action` 后，它使用真实 `stop_reason.event_ids` 找到对应的 `agent.custom_tool_use`，生成确定性的订单查询结果，批量回传 `user.custom_tool_result`，最后等待 `end_turn`：

```Bash
run_query_order_turn() (
  local session_id="$1"
  local user_text="${2:-查询订单 ORDER-1001 的状态。}"
  local stream_dir
  local stream_pipe
  local stream_pid=""
  local stream_ready=false
  local pending_file
  local line
  local data
  local event_type
  local stop_reason
  local pending_id
  local tool_event
  local tool_name
  local order_id
  local result_text
  local result_event
  local result_events
  local result_payload
  local message_count=0
  local turn_done=false
  local result_code=1

  : "${ARK_BASE_URL:?Set ARK_BASE_URL before calling run_query_order_turn}"
  : "${ARK_API_KEY:?Set ARK_API_KEY before calling run_query_order_turn}"
  : "${session_id:?Pass a Session ID as the first argument}"
  command -v curl >/dev/null || {
    printf 'curl is required.\n' >&2
    return 1
  }
  command -v jq >/dev/null || {
    printf 'jq is required.\n' >&2
    return 1
  }

  stream_dir=$(mktemp -d) || return 1
  stream_pipe="$stream_dir/events"
  pending_file="$stream_dir/pending.ndjson"
  : >"$pending_file"
  mkfifo "$stream_pipe" || {
    rm -rf "$stream_dir"
    return 1
  }

  cleanup_stream() {
    exec 3<&- || true
    if [[ -n $stream_pid ]] && kill -0 "$stream_pid" 2>/dev/null; then
      kill "$stream_pid" 2>/dev/null || true
    fi
    if [[ -n $stream_pid ]]; then
      wait "$stream_pid" 2>/dev/null || true
    fi
    rm -rf "$stream_dir"
  }
  trap cleanup_stream EXIT

  curl -sS -N --fail-with-body --max-time 600 \
    "$ARK_BASE_URL/sessions/$session_id/events/stream" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Accept: text/event-stream" >"$stream_pipe" &
  stream_pid=$!
  exec 3<"$stream_pipe"

  while IFS= read -r line <&3; do
    line=${line%$'\r'}
    if [[ $line == ": ready" ]]; then
      stream_ready=true
      break
    fi
  done
  if [[ $stream_ready != true ]]; then
    printf 'SSE stream closed before it was ready.\n' >&2
    return 1
  fi

  curl -sS --fail-with-body --connect-timeout 5 --max-time 30 \
    "$ARK_BASE_URL/sessions/$session_id/events" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg text "$user_text" \
      '{events: [{type: "user.message", content: [{type: "text", text: $text}]}]}')" \
    >/dev/null || return 1

  while IFS= read -r line <&3; do
    line=${line%$'\r'}
    [[ $line == data:* ]] || continue
    data=${line#data:}
    data=${data# }
    event_type=$(jq -r '.type // empty' <<<"$data" 2>/dev/null || true)

    case "$event_type" in
      agent.custom_tool_use)
        jq -c . <<<"$data" >>"$pending_file"
        printf '[tool] %s\n' "$(jq -r '.name // "unknown"' <<<"$data")"
        ;;
      agent.message)
        jq -r '.content[]? | select(.type == "text") | .text' <<<"$data"
        message_count=$((message_count + 1))
        ;;
      session.status_idle)
        stop_reason=$(jq -r '.stop_reason.type // empty' <<<"$data")
        case "$stop_reason" in
          requires_action)
            result_events='[]'
            while IFS= read -r pending_id; do
              [[ -n $pending_id ]] || continue
              tool_event=$(jq -sc --arg id "$pending_id" \
                'map(select(.id == $id)) | last // empty' "$pending_file")
              if [[ -z $tool_event ]]; then
                printf 'Missing custom tool event: %s\n' "$pending_id" >&2
                return 1
              fi

              tool_name=$(jq -r '.name // empty' <<<"$tool_event")
              if [[ $tool_name != "query_order" ]]; then
                printf 'Unsupported custom tool: %s\n' "$tool_name" >&2
                return 1
              fi

              order_id=$(jq -er '.input.order_id' <<<"$tool_event") || return 1
              result_text=$(jq -nc --arg order_id "$order_id" \
                '{order_id: $order_id, status: "shipped", carrier: "Example Express"}')
              result_event=$(jq -nc \
                --arg id "$pending_id" \
                --arg text "$result_text" \
                '{
                  type: "user.custom_tool_result",
                  custom_tool_use_id: $id,
                  is_error: false,
                  content: [{type: "text", text: $text}]
                }')
              result_events=$(jq -nc \
                --argjson current "$result_events" \
                --argjson event "$result_event" \
                '$current + [$event]')
            done < <(jq -r '.stop_reason.event_ids[]?' <<<"$data")

            if [[ $(jq 'length' <<<"$result_events") -eq 0 ]]; then
              printf 'requires_action did not include event IDs.\n' >&2
              return 1
            fi

            result_payload=$(jq -nc --argjson events "$result_events" \
              '{events: $events}')
            curl -sS --fail-with-body --connect-timeout 5 --max-time 30 \
              "$ARK_BASE_URL/sessions/$session_id/events" \
              -H "Authorization: Bearer $ARK_API_KEY" \
              -H "Content-Type: application/json" \
              -d "$result_payload" >/dev/null || return 1
            ;;
          end_turn)
            if ((message_count == 0)); then
              printf 'The turn ended without an agent.message event.\n' >&2
              result_code=5
            else
              result_code=0
            fi
            turn_done=true
            break
            ;;
          retries_exhausted)
            result_code=3
            turn_done=true
            break
            ;;
          *)
            printf 'Unknown session.status_idle stop_reason: %s\n' "$stop_reason" >&2
            result_code=5
            turn_done=true
            break
            ;;
        esac
        ;;
      session.status_terminated)
        result_code=4
        turn_done=true
        break
        ;;
      session.error)
        jq -r '"[error] \(.error.type // "unknown_error"): \(.error.message // "")"' \
          <<<"$data" >&2
        ;;
    esac
  done

  if [[ $turn_done != true ]]; then
    printf 'SSE stream closed before the turn finished.\n' >&2
    return 1
  fi
  return "$result_code"
)
```

运行函数：

```bash
run_query_order_turn "$SESSION_ID" "查询订单 ORDER-1001 的状态。"
```

正常完成时，函数输出 Agent 的最终回复并返回状态码 `0`。返回 `3` 表示本轮重试耗尽，返回 `4` 表示 Session 已终止。SSE 在终态前断开时，函数返回非零状态，不会把断流当作成功。

> **注意**
>
> 本节用固定订单结果演示业务侧执行器。接入真实系统时，只替换函数中 `query_order` 的业务查询逻辑，保留 `: ready`、`requires_action.event_ids`、`custom_tool_use_id` 和 `end_turn` 的处理顺序。

## 场景一：Custom Tool 生图

本场景演示如何通过 Custom Tool 接入企业已有的生图服务。完整链路包括：声明 `generate_image` 工具、创建 Agent 和 Session、发送用户消息、接收工具调用事件、执行生图逻辑并回传图片结果。

以下多媒体场景聚焦工具 Schema 和结果格式，只展示事件 payload。实际执行时，沿用 [运行最小可执行闭环](managed-agent-custom-tool-tutorial.md#run-minimal-loop) 中的 SSE 循环，并替换业务处理逻辑。不要在尚未收到 `: ready` 时单独执行发送消息的 cURL。

创建 Agent 时，在 `tools` 中声明生图工具：

```json
{
  "type": "custom",
  "name": "generate_image",
  "description": "调用业务侧生图服务生成图片。当用户明确要求创建、绘制或生成图片时使用；不要用于回答纯文本问题。prompt 需要描述主体、场景、风格和关键约束；size 决定输出尺寸；n 决定返回图片数量。",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "完整的生图提示词。"
      },
      "size": {
        "type": "string",
        "description": "输出尺寸，例如 2048x2048。"
      },
      "watermark": {
        "type": "boolean",
        "description": "是否添加水印。"
      },
      "n": {
        "type": "integer",
        "minimum": 1,
        "maximum": 4,
        "description": "返回图片数量。"
      }
    },
    "required": ["prompt"],
    "additionalProperties": false
  }
}
```

创建包含该工具的 Agent 并创建 Session 后，发送生图请求：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [
          {
            "type": "text",
            "text": "生成一张 2048x2048 的产品海报：一只透明玻璃咖啡杯放在木质桌面上，清晨自然光，背景有浅景深绿植，干净商业摄影风格。"
          }
        ]
      }
    ]
  }'
```

模型产生 `agent.custom_tool_use`：

```json
{
  "id": "sevt-20260729153201-****",
  "type": "agent.custom_tool_use",
  "name": "generate_image",
  "input": {
    "prompt": "透明玻璃咖啡杯放在木质桌面上，清晨自然光，背景有浅景深绿植，干净商业摄影风格，产品海报构图",
    "size": "2048x2048",
    "watermark": true,
    "n": 1
  }
}
```

随后 Session 进入 `idle`，`stop_reason.type` 为 `requires_action`：

```json
{
  "id": "sevt-20260729153202-****",
  "type": "session.status_idle",
  "stop_reason": {
    "type": "requires_action",
    "event_ids": [
      "sevt-20260729153201-****"
    ]
  }
}
```

业务侧执行器调用生图服务，并回传工具结果：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt-20260729153201-****",
        "is_error": false,
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"image_count\":1,\"delivery\":\"base64\",\"request_id\":\"req-20260729153215-****\",\"usage\":{\"generated_images\":1}}"
          },
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUgAA...****"
            }
          }
        ]
      }
    ]
  }'
```

模型拿到结果后即可回复用户，例如：

```json
{
  "type": "agent.message",
  "content": [
    {
      "type": "text",
      "text": "图片已生成，画面为清晨自然光下的玻璃咖啡杯产品海报。"
    }
  ]
}
```

## 场景二：多图 Base64 回传

本场景演示一个工具调用返回多个多模态内容块。可以复用场景一中的 `generate_image` 工具声明，但需要在 `input_schema` 中为 `n` 设置合理范围，例如 `minimum: 1`、`maximum: 4`。

创建包含该工具的 Agent 和 Session 后，用户可以要求一次生成多张图片：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [
          {
            "type": "text",
            "text": "为同一个智能音箱生成 3 张电商主图，分别展示正面、45 度角和使用场景。"
          }
        ]
      }
    ]
  }'
```

Agent 生成的工具调用事件示例如下：

```json
{
  "id": "sevt-20260729154001-****",
  "type": "agent.custom_tool_use",
  "name": "generate_image",
  "input": {
    "prompt": "同一个智能音箱的 3 张电商主图，白色背景，柔和阴影，分别展示正面、45 度角和使用场景",
    "size": "2048x2048",
    "watermark": true,
    "n": 3
  }
}
```

回传结果时，文本块只放机器可读摘要，不重复塞入 Base64；每张图独立使用一个 `image/base64` 内容块：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt-20260729154001-****",
        "is_error": false,
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"image_count\":3,\"delivery\":\"base64\",\"request_ids\":[\"req-20260729154011-****\",\"req-20260729154018-****\",\"req-20260729154025-****\"],\"usage\":{\"generated_images\":3}}"
          },
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUgAA...image_1...****"
            }
          },
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUgAA...image_2...****"
            }
          },
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUgAA...image_3...****"
            }
          }
        ]
      }
    ]
  }'
```

这种结构有两个好处：

- 文本 JSON 便于 Agent 判断工具是否成功、生成了几张图、是否需要重试。
- 原生 `image` 内容块便于模型直接消费图像模态，不需要从文本中解析大段 Base64。

## 场景三：File ID 参考生视频

本场景演示如何让 Custom Tool 接收 File ID，并由业务侧把文件解析为视频生成服务可读取的参考素材。适用于参考图、参考视频、参考音频等素材已经通过 Files API 上传的场景。

创建 Agent 时，声明 `generate_video` 工具：

```json
{
  "type": "custom",
  "name": "generate_video",
  "description": "提交异步生视频任务。当用户要求生成视频、基于参考素材生成视频或图生视频时使用。调用成功只表示任务已提交；需要通过 get_video_task 查询完成状态。",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "视频提示词，描述主体、动作、场景、镜头和风格。"
      },
      "model": {
        "type": "string",
        "description": "生视频模型 ID 或 Endpoint ID。"
      },
      "reference_image_sources": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": ["url", "file", "tos"]
            },
            "url": {
              "type": "string"
            },
            "file_id": {
              "type": "string"
            },
            "tos_uri": {
              "type": "string"
            }
          },
          "required": ["type"],
          "additionalProperties": false
        },
        "description": "参考图片来源列表。"
      },
      "duration": {
        "type": "integer",
        "description": "视频时长，单位秒。"
      },
      "ratio": {
        "type": "string",
        "description": "画面比例，例如 16:9、9:16、1:1。"
      },
      "wait_for_completion": {
        "type": "boolean",
        "description": "是否等待任务完成后再回传工具结果。"
      }
    },
    "additionalProperties": false
  }
}
```

创建包含该工具的 Agent 和 Session 后，用户可以在消息中引用 File ID：

用户请求：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [
          {
            "type": "text",
            "text": "用 file-20260729160108-**** 这张参考图生成一个 5 秒 16:9 视频：杯子旁边的蒸汽缓慢升起，镜头轻微推进，清晨暖光。"
          }
        ]
      }
    ]
  }'
```

模型调用 `generate_video`：

```json
{
  "id": "sevt-20260729160130-****",
  "type": "agent.custom_tool_use",
  "name": "generate_video",
  "input": {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "参考图中的杯子保持主体一致，蒸汽缓慢升起，镜头轻微推进，清晨暖光，商业摄影质感",
    "reference_image_sources": [
      {
        "type": "file",
        "file_id": "file-20260729160108-****"
      }
    ],
    "duration": 5,
    "ratio": "16:9",
    "wait_for_completion": false
  }
}
```

业务侧执行器可以把 File ID 解析为视频生成服务可访问的素材，再提交异步任务。首次回传通常只表示任务已受理：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt-20260729160130-****",
        "is_error": false,
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"task_id\":\"cgt-20260729160142-****\",\"model\":\"doubao-seedance-2-0-260128\",\"status\":\"queued\",\"video_url\":null}"
          }
        ]
      }
    ]
  }'
```

用户稍后查询任务：

```json
{
  "id": "sevt-20260729160810-****",
  "type": "agent.custom_tool_use",
  "name": "get_video_task",
  "input": {
    "task_id": "cgt-20260729160142-****",
    "model": "doubao-seedance-2-0-260128"
  }
}
```

任务完成时的回传示例：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt-20260729160810-****",
        "is_error": false,
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"task_id\":\"cgt-20260729160142-****\",\"model\":\"doubao-seedance-2-0-260128\",\"status\":\"succeeded\",\"video_url\":\"https://example-cdn.volces.com/video/cgt-20260729160142-****.mp4\",\"usage\":{\"duration\":5}}"
          }
        ]
      }
    ]
  }'
```

视频结果建议以文本 JSON 返回 `video_url`。当前不要把 MP4 二进制作为 `document/base64` 塞回 Tool Result；这会显著放大事件体积，也可能无法被模型消费层按视频模态解析。

## 场景四：查询并理解视频

本场景演示如何把异步任务查询和后续视频理解串联起来。查询任务和理解视频内容是两个动作：

1. `get_video_task` 负责确认任务状态，并拿到 `video_url`。
2. 内置多模态或视频理解工具负责读取 `video_url` 并总结画面内容。

创建 Agent 时，声明任务查询工具：

```json
{
  "type": "custom",
  "name": "get_video_task",
  "description": "查询异步视频任务。当用户要求查看视频生成进度、确认任务是否完成或获取视频结果时使用。任务未完成时只能说明仍在生成；任务成功且包含 video_url 时，才能说明视频已完成。",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "视频任务 ID。"
      },
      "model": {
        "type": "string",
        "description": "创建任务时使用的模型 ID，可省略。"
      }
    },
    "required": ["task_id"],
    "additionalProperties": false
  }
}
```

创建包含该工具的 Agent 和 Session 后，用户请求查询并理解视频：

```Bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/sessions/sesn-20260729153122-****/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [
          {
            "type": "text",
            "text": "查询任务 cgt-20260729160142-****。如果视频已经完成，请理解视频内容并总结镜头、主体动作和视觉风格。"
          }
        ]
      }
    ]
  }'
```

模型先调用 `get_video_task`：

```json
{
  "id": "sevt-20260729162000-****",
  "type": "agent.custom_tool_use",
  "name": "get_video_task",
  "input": {
    "task_id": "cgt-20260729160142-****",
    "model": "doubao-seedance-2-0-260128"
  }
}
```

业务侧执行器回传视频 URL：

```json
{
  "events": [
    {
      "type": "user.custom_tool_result",
      "custom_tool_use_id": "sevt-20260729162000-****",
      "is_error": false,
      "content": [
        {
          "type": "text",
          "text": "{\"ok\":true,\"task_id\":\"cgt-20260729160142-****\",\"model\":\"doubao-seedance-2-0-260128\",\"status\":\"succeeded\",\"video_url\":\"https://example-cdn.volces.com/video/cgt-20260729160142-****.mp4\"}"
        }
      ]
    }
  ]
}
```

接下来，Agent 应使用环境中可用的内置视频理解能力读取该 `video_url`。如果您的环境把该能力暴露为内置工具，可以在 Agent 的 system prompt 中明确要求：

```text
当 get_video_task 返回 status=succeeded 且包含 video_url，并且用户要求理解视频内容时，继续调用环境中可用的内置多模态或视频理解工具读取 video_url；不要仅凭 prompt 或 task_id 猜测视频内容。
```

最终回复示例：

```json
{
  "type": "agent.message",
  "content": [
    {
      "type": "text",
      "text": "任务已完成。视频主体是一只透明玻璃咖啡杯，蒸汽从杯口缓慢升起；镜头从中景轻微推进到近景，背景绿植保持浅景深虚化，整体是清晨暖光下的干净商业摄影风格。"
    }
  ]
}
```

如果当前环境没有视频理解内置工具，Agent 应说明只能确认 `video_url` 已生成，不能声称已经理解视频画面。

## 业务侧执行器参考逻辑

业务侧执行器需要维护一个待处理工具调用表。收到 `agent.custom_tool_use` 时先记录事件；收到 `session.status_idle` 且 `stop_reason.type` 为 `requires_action` 时，按 `event_ids` 找到对应工具调用，执行并批量回传。

```python
pending = {}

def process_event(event):
    event_type = event.get("type")

    if event_type == "agent.custom_tool_use":
        pending[event["id"]] = event
        return

    if event_type != "session.status_idle":
        return

    stop_reason = event.get("stop_reason") or {}
    if stop_reason.get("type") != "requires_action":
        return

    results = []
    for event_id in stop_reason.get("event_ids", []):
        tool_event = pending.pop(event_id)
        result = execute_custom_tool(tool_event)
        results.append({
            "type": "user.custom_tool_result",
            "custom_tool_use_id": event_id,
            "is_error": not result["ok"],
            "content": to_tool_result_content(result),
        })

    post_session_events({"events": results})
```

## 常见问题

### `input_schema` 是否可以传字符串？

不可以。`input_schema` 必须以 JSON 对象传入，且顶层 `type` 仅支持 `object`。

### Custom Tool 名称有什么限制？

API 允许名称包含 1～128 个字符，只能使用英文字母、数字、下划线或连字符。为保证模型稳定引用，建议将名称控制在 1～64 个字符，例如 `generate_image`、`get_video_task`。同一个 Agent 最多配置 8 个 Custom Tool。

### 为什么视频结果只返回 `video_url`？

视频生成通常是异步任务，MP4 体积较大，直接作为 Tool Result 回传不适合。推荐返回文本 JSON，让 Agent、前端或后续内置视频理解工具通过 `video_url` 继续处理。

### 多个 Custom Tool 同时触发时怎么回传？

以 `stop_reason.event_ids` 为准。该数组里的所有工具调用都完成后，放在同一个 `events` 数组中批量发送：

```json
{
  "events": [
    {
      "type": "user.custom_tool_result",
      "custom_tool_use_id": "sevt-20260729163001-****",
      "is_error": false,
      "content": [
        {
          "type": "text",
          "text": "{\"ok\":true,\"value\":\"alpha\"}"
        }
      ]
    },
    {
      "type": "user.custom_tool_result",
      "custom_tool_use_id": "sevt-20260729163002-****",
      "is_error": false,
      "content": [
        {
          "type": "text",
          "text": "{\"ok\":true,\"value\":\"beta\"}"
        }
      ]
    }
  ]
}
```

### 调试建议

- 业务侧执行器先建立 SSE 并等待 `: ready`，再发送用户消息，避免错过 `requires_action`。
- 工具执行失败时也要回传 `user.custom_tool_result`，并设置 `is_error: true`。
- 不要在日志或文档中打印真实 API Key、完整签名 URL、完整 Base64 或未脱敏资源 ID。
- 生图和生视频后端建议使用独立的最小权限 API Key，便于审计和轮换。
