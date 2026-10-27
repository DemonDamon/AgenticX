---
source: https://ark.volcengine.com/region:cn-beijing/docs/visual-creation-agent
fetched: 2026-10-24
title: \[基础\] 使用 Seedance Managed Agent 生成图片和视频
---

# [基础] 使用 Seedance Managed Agent 生成图片和视频

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本教程演示如何使用火山方舟 Managed Agents 的 **Seedance Managed Agent**，完成从创意描述到图片、视频产物的完整流程。Seedance Managed Agent 支持图片与视频的生成、检索和合成。

您将创建 Agent、Environment 和 Session，通过 Session 事件流观察生成过程，再通过 Files API 下载最终产物。

<span id="scenario"></span>
## 场景说明

制作营销素材时，常见流程包含素材检索、主视觉生成、视频生成和产物存储。直接串联图片与视频生成 API 时，业务系统还需要自行处理提示词拆解、任务轮询、文件转存和失败重试。

本教程以城市精品咖啡新品宣传为例。您只需描述素材用途、主体、风格、画幅和时长，Seedance Managed Agent 会先生成一张 16:9 主视觉，再以该图片为首帧生成 4 秒视频。执行期间，您可以通过 Session SSE 观察工具调用和任务状态；任务完成后，通过 Files API 下载 JPEG 图片和 MP4 视频。

<span id="what-you-will-do"></span>
## 您将完成什么

- 创建一个用于生成图片和视频的 Seedance Managed Agent。
- 显式配置基础工具集、多模态工具集及图片和视频生成模型。
- 通过一段自然语言任务，获得一张 16:9 主视觉和一段 4 秒宣传视频。
- 通过 Session SSE 观察执行过程，并通过 Files API 下载最终产物。
- 按依赖顺序清理本教程创建的资源。

<span id="core-concepts"></span>
## 核心概念

- **Agent**：可版本化的智能体配置，定义模型、系统提示词和工具集。
- **Seedance Managed Agent**：面向图片和视频创作的 Agent，使用 `ultra_vision_agent_preview` 标识。
- **基础工具集**：`agent_toolset_20260916`，提供文件读写和代码执行等通用能力。
- **多模态工具集**：`agent_toolset_multimodal_20260825`，提供图片生成、视频生成、视觉搜索、通用搜索、视频合成和任务进度管理能力。
- **Environment**：Agent 执行任务时使用的云端沙箱配置。
- **Session**：绑定 Agent 与 Environment 的一次运行实例，负责保存事件和产物。
- **Files API**：按 Session ID 查询已注册产物，并获取文件名和下载地址。

<span id="prerequisites"></span>
## 前置条件

- 已开通火山方舟 Managed Agents。
- 已开通 Seedance Managed Agent 使用权限。
- 已从控制台的 Seedance Managed Agent 创建页面展示的可选模型中选择 Agent 主模型，并开通该模型服务。
- 已开通图片生成和视频生成所需的模型服务。
- 已开通视觉搜索等任务需要的工具服务。
- 已创建 API Key，详情请参见 [API Key 管理](https://ark.volcengine.com/docs/manage-api-keys)。
- 本地已安装 `curl` 7.76.0 或更高版本，以及 `jq`。

配置以下环境变量：

```Bash
export ARK_API_KEY="<YOUR_API_KEY>"  # gitleaks:allow
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export AGENT_MODEL_ID="doubao-seed-2-1-lite-260915"
export IMAGE_MODEL_ID="doubao-seedream-5-0-pro-260628"
export VIDEO_MODEL_ID="doubao-seedance-2-5-260628"
```

> **说明**
>
> 上方三个模型 ID 用作本教程示例。也可以填写对应的推理接入点 ID。可用模型以控制台的 Seedance Managed Agent 创建页面为准；如果页面未展示其中某个模型，请将对应环境变量替换为页面提供的可选模型 ID。
>
> 不同图片生成模型支持的输出格式可能不同。本教程统一输出 JPEG 图片；替换为支持 PNG 格式的模型后，可以将任务中的图片文件扩展名改为 `.png`。

> **注意**
>
> API Key 会授权模型调用和 Agent 资源操作。仅在服务端环境中使用，不要写入前端代码、日志或截图。

<span id="api-workflow"></span>
## 使用 API 生成图片和视频

<span id="configuration-constraints"></span>
### 配置约束

创建 Seedance Managed Agent 前，按下表检查配置：

| 配置项 | 字段或工具 | 要求 |
| --- | --- | --- |
| Agent 类型 | `base_agent` | 设置为 `ultra_vision_agent_preview`，用于创建 Seedance Managed Agent。创建后不能修改该字段；已创建的通用 Agent 不能直接变更为 Seedance Managed Agent。 |
| 主模型 | `model.id` | 必须填写。请从控制台的 Seedance Managed Agent 创建页面展示的模型中选择。 |
| 推理强度 | `model.reasoning_effort` | 固定为 `high`。省略时服务端自动补齐为 `high`；填写其他值时返回 400 `InvalidParameter`。 |
| 图片生成模型 | `image_generate.models[].id` | 必须填写模型 ID 或推理接入点 ID。每个工具最多配置 10 项；配置多项时，必须且只能将一项设置为默认模型。 |
| 视频生成模型 | `video_generate.models[].id` | 启用 `video_generate` 时必须填写模型 ID 或推理接入点 ID。每个工具最多配置 10 项；配置多项时，必须且只能将一项设置为默认模型。 |
| 基础工具集 | `agent_toolset_20260916` | 必须配置该工具集。 |
| 多模态工具集 | `agent_toolset_multimodal_20260825` | 必须配置该工具集。 |
| 必选工具 | `image_generate`、`visual_search`、`general_search`、`compose_video` | 必须启用全部工具。 |
| 可选工具 | `video_generate`、`todo_write` | 按需启用。本教程显式启用视频生成和任务进度管理，并为 `video_generate` 绑定视频生成模型。 |
| 搜索工具 | `general_search`、`web_search` | 启用 `general_search` 时，必须关闭基础工具集中的 `web_search`。 |
| 系统提示词 | `system` | 用于定义 Seedance Managed Agent 在视觉创作任务中的角色、工作方式和输出要求。 |

<span id="step-1-create-agent"></span>
### 第 1 步：创建 Seedance Managed Agent

创建 Agent 时，将 `base_agent` 设置为 `ultra_vision_agent_preview`。同时配置基础工具集、多模态工具集，以及图片和视频生成模型。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${AGENT_MODEL_ID:?Set AGENT_MODEL_ID to a model shown for Visual Creation Agent in the console}"
: "${IMAGE_MODEL_ID:?Set IMAGE_MODEL_ID to an image model shown for Visual Creation Agent in the console}"
: "${VIDEO_MODEL_ID:?Set VIDEO_MODEL_ID to a video model shown for Visual Creation Agent in the console}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
RUN_SUFFIX="${RUN_SUFFIX:-$(date +%Y%m%d%H%M%S)}"
SYSTEM_PROMPT='You are Seed Creation Agent, an interactive creation agent with a sandbox environment. You help users turn ideas, requirements, and source materials into finished creative deliverables.

Supported work includes, but is not limited to, images, videos, audio, scripts, copywriting, storyboards, prompts, presentations, documents, structured content, creative plans, and multi-file projects. Use the instructions below and the available tools to assist the user.'

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

agent_payload=$(jq -n \
  --arg name "visual-creation-agent-$RUN_SUFFIX" \
  --arg agent_model "$AGENT_MODEL_ID" \
  --arg image_model "$IMAGE_MODEL_ID" \
  --arg video_model "$VIDEO_MODEL_ID" \
  --arg system_prompt "$SYSTEM_PROMPT" \
  '{
    name: $name,
    description: "Generate campaign images and videos in one Session.",
    # The visual enhancement Agent requires high reasoning effort.
    model: {
      id: $agent_model,
      reasoning_effort: "high"
    },
    # Select the visual enhancement Agent type.
    base_agent: "ultra_vision_agent_preview",
    system: $system_prompt,
    tools: [
      # Mount the base tools, but disable web_search because general_search is enabled below.
      {
        type: "agent_toolset_20260916",
        default_config: {
          enabled: true
        },
        configs: [
          {name: "web_search", enabled: false}
        ]
      },
      # Disable multimodal defaults and explicitly enable the tools used by this tutorial.
      {
        type: "agent_toolset_multimodal_20260825",
        default_config: {
          enabled: false
        },
        configs: [
          {
            name: "image_generate",
            enabled: true,
            # A single configured model is also the default image model.
            models: [
              {id: $image_model, default: true}
            ]
          },
          {
            name: "video_generate",
            enabled: true,
            # A single configured model is also the default video model.
            models: [
              {id: $video_model, default: true}
            ]
          },
          {name: "visual_search", enabled: true},
          {name: "general_search", enabled: true},
          {name: "compose_video", enabled: true},
          {name: "todo_write", enabled: true}
        ]
      }
    ]
  }')

agent=$(
  request_json POST "$ARK_BASE_URL/agents" \
    -H "Content-Type: application/json" \
    -d "$agent_payload"
)

AGENT_ID=$(jq -er '.id' <<<"$agent")

echo "Agent ID: $AGENT_ID"
```

期望输出：

```Text
Agent ID: agent-20260924120000-xxxxx
```

记录 `AGENT_ID`，创建 Session 时需要使用该值。

> **注意**
>
> 配置不支持 Seedance Managed Agent 所需工具的图片或视频模型、缺少任一必选工具、同时启用 `web_search` 与 `general_search`，或为 `reasoning_effort` 填写 `high` 之外的值时，服务端返回 400 `InvalidParameter`。未开通 Seedance Managed Agent 使用权限时，服务端返回 403 `OperationDenied`。
>
> 示例会将 HTTP 状态码和服务端返回的完整 JSON 写入标准错误。根据 `error.message` 修正模型或工具配置后再重试。

<span id="step-2-create-environment"></span>
### 第 2 步：创建 Environment

创建一个云端 Environment，作为视觉创作任务的运行环境。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
RUN_SUFFIX="${RUN_SUFFIX:-$(date +%Y%m%d%H%M%S)}"

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

environment_payload=$(jq -n \
  --arg name "visual-creation-env-$RUN_SUFFIX" \
  '{
    name: $name,
    description: "Cloud environment for visual creation tasks.",
    config: {
      type: "cloud",
      networking: {type: "unrestricted"}
    }
  }')

environment=$(
  request_json POST "$ARK_BASE_URL/environments" \
    -H "Content-Type: application/json" \
    -d "$environment_payload"
)

ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")

echo "Environment ID: $ENVIRONMENT_ID"
```

期望输出：

```Text
Environment ID: env-20260924120100-xxxxx
```

记录 `ENVIRONMENT_ID`，下一步创建 Session 时需要使用该值。

> **说明**
>
> 本示例未配置 `config.tos`，产物使用方舟公共 TOS。需要长期保存产物时，为 Environment 配置自己的 TOS Bucket，详情请参见 [配置产物存储](../configure-cloud-environment.md#configure-output-storage)。

> **注意**
>
> 示例使用 `networking.type=unrestricted`，便于完成教程。生产环境应按任务所需的外部地址收敛网络策略。

<span id="step-3-create-session"></span>
### 第 3 步：创建 Session

创建 Session，将 Seedance Managed Agent 与 Environment 绑定。创建成功后，Session 处于 `idle`，不会自动开始任务。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${AGENT_ID:?Set AGENT_ID to the Visual Creation Agent ID}"
: "${ENVIRONMENT_ID:?Set ENVIRONMENT_ID to the cloud environment ID}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

session_payload=$(jq -n \
  --arg agent "$AGENT_ID" \
  --arg environment "$ENVIRONMENT_ID" \
  '{
    agent: $agent,
    environment_id: $environment,
    title: "Coffee campaign visual creation"
  }')

session=$(
  request_json POST "$ARK_BASE_URL/sessions" \
    -H "Content-Type: application/json" \
    -d "$session_payload"
)

SESSION_ID=$(jq -er '.id' <<<"$session")

echo "Session ID: $SESSION_ID"
```

期望输出：

```Text
Session ID: sesn-20260924120200-xxxxx
```

记录 `SESSION_ID`，发送任务、监听事件和查询产物时都需要使用该值。

<span id="step-4-run-task"></span>
### 第 4 步：发送创作任务并监听事件

先打开 SSE 事件流，再发送 `user.message`。这样可以从任务开始时连续观察 Agent 消息、工具调用和状态变化。

本示例让 Agent 先生成一张 16:9 的咖啡品牌主视觉，再以该图片为首帧生成 4 秒宣传视频。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${SESSION_ID:?Set SESSION_ID to the visual creation Session ID}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

stream_events() {
  local seen_running=0
  local stream_error_file
  local stream_result="ended"

  stream_error_file=$(mktemp)

  while IFS= read -r line; do
    [[ "$line" == data:* ]] || continue

    json="${line#data: }"
    event_type=$(jq -r '.type // empty' <<<"$json" 2>/dev/null || true)

    case "$event_type" in
      session.status_running)
        seen_running=1
        echo "[Session] running"
        ;;
      agent.tool_use)
        printf '[Tool] %s\n' "$(jq -r '.name // "unknown"' <<<"$json")"
        ;;
      agent.tool_result)
        jq -c '{type, tool_use_id, is_error}' <<<"$json"
        ;;
      agent.message)
        jq -r '.content[]? | select(.type == "text") | .text' <<<"$json"
        ;;
      session.error)
        jq . <<<"$json" >&2
        stream_result="error"
        break
        ;;
      session.status_idle)
        if [[ "$seen_running" -eq 1 ]]; then
          echo "[Session] idle"
          stream_result="idle"
          break
        fi
        ;;
    esac
  done < <(
    curl -sS -N --fail-with-body --max-time 1800 \
      "$ARK_BASE_URL/sessions/$SESSION_ID/events/stream" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      -H "Accept: text/event-stream" \
      2>"$stream_error_file"
  )

  if [[ "$stream_result" == "idle" ]]; then
    rm -f "$stream_error_file"
    return 0
  fi

  if [[ "$stream_result" == "error" ]]; then
    rm -f "$stream_error_file"
    return 1
  fi

  if [[ -s "$stream_error_file" ]]; then
    cat "$stream_error_file" >&2
  fi
  rm -f "$stream_error_file"
  echo "SSE stream ended before the Session returned to idle." >&2
  return 1
}

stream_events &
STREAM_PID=$!
trap 'kill "$STREAM_PID" 2>/dev/null || true' EXIT

sleep 2

task_payload=$(cat <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [
        {
          "type": "text",
          "text": "为一家城市精品咖啡品牌制作一组新品宣传素材。先生成一张 16:9 的电影感主视觉：清晨城市街角，手冲咖啡放在窗边木桌上，暖色自然光，画面中不要出现文字，并保存为 /mnt/session/outputs/campaign-key-visual.jpg。再以这张图为首帧，生成一段 4 秒、16:9 的宣传视频，镜头缓慢推进，咖啡蒸汽自然上升，并保存为 /mnt/session/outputs/campaign-teaser.mp4。完成后总结两个文件的名称和生成结果。"
        }
      ]
    }
  ]
}
EOF
)

request_json POST \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "$task_payload" >/dev/null

wait "$STREAM_PID"
trap - EXIT
```

任务执行期间，终端会持续输出事件。期望看到的关键轨迹如下：

```Text
[Session] running
[Tool] GenImage
{"type":"agent.tool_result","tool_use_id":"...","is_error":false}
[Tool] GenVideo
{"type":"agent.tool_result","tool_use_id":"...","is_error":false}
<Agent 最终回复>
[Session] idle
```

根据任务内容，事件流中还可能穿插 `GeneralSearch`、`VisualSearch`、`ViewMedia`、`TodoWrite` 或 `record_search_quality` 等工具调用。工具调用的顺序和次数不固定。

`session.status_idle` 表示当前轮次结束。不要以单条 `agent.message` 或连接短暂中断判断任务完成。

> **注意**
>
> 视频生成通常需要数分钟。示例为 SSE 连接设置了 30 分钟超时，并在收到 `session.status_idle` 后主动结束监听。收到 `session.error` 时，应读取事件中的错误信息，不要直接重复提交任务，以免产生重复生成费用。如果事件流在 `idle` 前异常结束，示例会输出 curl 错误并返回非零状态。

<span id="step-5-download-outputs"></span>
### 第 5 步：查询并下载产物

Agent 将交付物写入 `/mnt/session/outputs/`。文件注册存在短暂延迟，因此示例会轮询 Files API，直到同时查询到图片和视频。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${SESSION_ID:?Set SESSION_ID to the visual creation Session ID}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
OUTPUT_DIR="${OUTPUT_DIR:-./visual-creation-agent-output}"
files='{"data":[]}'
image_count=0
video_count=0

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

# Output registration is asynchronous, so wait for one image and one video.
for _ in $(seq 1 60); do
  files=$(
    request_json GET "$ARK_BASE_URL/files?scope_id=$SESSION_ID"
  )

  image_count=$(jq '[.data[]? | select((.mime_type // "") | startswith("image/"))] | length' <<<"$files")
  video_count=$(jq '[.data[]? | select((.mime_type // "") | startswith("video/"))] | length' <<<"$files")

  if [[ "$image_count" -ge 1 && "$video_count" -ge 1 ]]; then
    break
  fi

  sleep 2
done

if [[ "$image_count" -lt 1 || "$video_count" -lt 1 ]]; then
  echo "Expected image and video outputs were not registered in time." >&2
  jq . <<<"$files" >&2
  exit 1
fi

echo "Output files:"
jq -r '
  .data[]
  | select((.mime_type // "") | test("^(image|video)/"))
  | [.id, .filename, .mime_type]
  | @tsv
' <<<"$files"

mkdir -p "$OUTPUT_DIR"

jq -r '
  .data[]
  | select((.mime_type // "") | test("^(image|video)/"))
  | select(.download_url != null and .download_url != "")
  | [.filename, .download_url]
  | @tsv
' <<<"$files" |
  while IFS=$'\t' read -r filename download_url; do
    safe_name=$(basename "$filename")
    curl -sS --fail-with-body "$download_url" -o "$OUTPUT_DIR/$safe_name"
    echo "Downloaded: $OUTPUT_DIR/$safe_name"
  done
```

期望输出：

```Text
Output files:
file-20260924121000-xxxxx    campaign-key-visual.jpg    image/jpeg
file-20260924121500-yyyyy    campaign-teaser.mp4        video/mp4
Downloaded: ./visual-creation-agent-output/campaign-key-visual.jpg
Downloaded: ./visual-creation-agent-output/campaign-teaser.mp4
```

脚本会读取 Files API 返回的 `download_url` 并直接下载文件，因此终端输出不会打印该字段。`download_url` 是服务端签发的临时下载地址，应在获得后及时使用，不要将其作为长期静态链接保存。

<span id="verify"></span>
### 第 6 步：验证生成结果

按下表检查本次运行是否成功：

| 检查项 | 通过标准 |
| --- | --- |
| Agent 创建 | 返回 `agent-` 开头的 `AGENT_ID` |
| Environment 创建 | 返回 `env-` 开头的 `ENVIRONMENT_ID` |
| Session 创建 | 返回 `sesn-` 开头的 `SESSION_ID`，初始状态为 `idle` |
| 任务执行 | 事件流先出现 `session.status_running`，最终出现 `session.status_idle` |
| 工具结果 | 图片和视频相关的 `agent.tool_result.is_error` 均为 `false` |
| 产物注册 | Files API 至少返回一个 `image/*` 文件和一个 `video/*` 文件 |
| 本地文件 | `visual-creation-agent-output` 目录中存在可打开的图片和可播放的视频 |

如果事件流显示生成成功，但 Files API 尚未返回文件，继续等待注册完成。不要仅根据 Agent 的文本回复判断产物已经可下载。

<span id="complete-example"></span>
### 运行完整脚本

以下脚本仅用于演示 Agent、Environment、Session、事件流和 Files API 的完整调用流程。

`CLEANUP_RESOURCES` 默认值为 `0`，因此脚本成功执行后会保留本次创建的 Agent、Environment 和 Session，便于检查运行结果或继续复用这些资源。如需在下载产物后自动清理资源，在运行脚本前执行 `export CLEANUP_RESOURCES=1`。无论是否设置该变量，脚本执行失败时都会自动清理本次已创建的资源。

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${AGENT_MODEL_ID:?Set AGENT_MODEL_ID to a model shown for Visual Creation Agent in the console}"
: "${IMAGE_MODEL_ID:?Set IMAGE_MODEL_ID to an image model shown for Visual Creation Agent in the console}"
: "${VIDEO_MODEL_ID:?Set VIDEO_MODEL_ID to a video model shown for Visual Creation Agent in the console}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
OUTPUT_DIR="${OUTPUT_DIR:-./visual-creation-agent-output}"
RUN_SUFFIX="${RUN_SUFFIX:-$(date +%Y%m%d%H%M%S)}"
SYSTEM_PROMPT='You are Seed Creation Agent, an interactive creation agent with a sandbox environment. You help users turn ideas, requirements, and source materials into finished creative deliverables.

Supported work includes, but is not limited to, images, videos, audio, scripts, copywriting, storyboards, prompts, presentations, documents, structured content, creative plans, and multi-file projects. Use the instructions below and the available tools to assist the user.'

AGENT_ID=""
ENVIRONMENT_ID=""
SESSION_ID=""
STREAM_PID=""

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

stop_stream() {
  if [[ -n "$STREAM_PID" ]]; then
    kill "$STREAM_PID" 2>/dev/null || true
  fi
}

cleanup_resources() {
  local cleanup_status=0

  if [[ -n "$SESSION_ID" ]]; then
    if ! request_json DELETE "$ARK_BASE_URL/sessions/$SESSION_ID" >/dev/null; then
      cleanup_status=1
    fi
  fi
  if [[ -n "$AGENT_ID" ]]; then
    if ! request_json DELETE "$ARK_BASE_URL/agents/$AGENT_ID" >/dev/null; then
      cleanup_status=1
    fi
  fi
  if [[ -n "$ENVIRONMENT_ID" ]]; then
    if ! request_json DELETE "$ARK_BASE_URL/environments/$ENVIRONMENT_ID" >/dev/null; then
      cleanup_status=1
    fi
  fi

  return "$cleanup_status"
}

on_exit() {
  local exit_code=$?

  trap - EXIT
  stop_stream

  if [[ "$exit_code" -ne 0 ]]; then
    if [[ -n "$SESSION_ID" || -n "$AGENT_ID" || -n "$ENVIRONMENT_ID" ]]; then
      echo "Run failed; cleaning up resources created by this script." >&2
      cleanup_resources || true
    fi
  elif [[ "${CLEANUP_RESOURCES:-0}" == "1" ]]; then
    if ! cleanup_resources; then
      exit_code=1
    fi
  fi

  exit "$exit_code"
}

trap on_exit EXIT

# Create the preset Visual Creation Agent.
agent_payload=$(jq -n \
  --arg name "visual-creation-agent-$RUN_SUFFIX" \
  --arg agent_model "$AGENT_MODEL_ID" \
  --arg image_model "$IMAGE_MODEL_ID" \
  --arg video_model "$VIDEO_MODEL_ID" \
  --arg system_prompt "$SYSTEM_PROMPT" \
  '{
    name: $name,
    description: "Generate campaign images and videos in one Session.",
    # The visual enhancement Agent requires high reasoning effort.
    model: {
      id: $agent_model,
      reasoning_effort: "high"
    },
    # Select the visual enhancement Agent type.
    base_agent: "ultra_vision_agent_preview",
    system: $system_prompt,
    tools: [
      # Mount the base tools, but disable web_search because general_search is enabled below.
      {
        type: "agent_toolset_20260916",
        default_config: {
          enabled: true
        },
        configs: [
          {name: "web_search", enabled: false}
        ]
      },
      # Disable multimodal defaults and explicitly enable the tools used by this tutorial.
      {
        type: "agent_toolset_multimodal_20260825",
        default_config: {
          enabled: false
        },
        configs: [
          {
            name: "image_generate",
            enabled: true,
            # A single configured model is also the default image model.
            models: [
              {id: $image_model, default: true}
            ]
          },
          {
            name: "video_generate",
            enabled: true,
            # A single configured model is also the default video model.
            models: [
              {id: $video_model, default: true}
            ]
          },
          {name: "visual_search", enabled: true},
          {name: "general_search", enabled: true},
          {name: "compose_video", enabled: true},
          {name: "todo_write", enabled: true}
        ]
      }
    ]
  }')

agent=$(
  request_json POST "$ARK_BASE_URL/agents" \
    -H "Content-Type: application/json" \
    -d "$agent_payload"
)
AGENT_ID=$(jq -er '.id' <<<"$agent")
echo "Agent ID: $AGENT_ID"

# Create a reusable cloud environment.
environment_payload=$(jq -n \
  --arg name "visual-creation-env-$RUN_SUFFIX" \
  '{
    name: $name,
    description: "Cloud environment for visual creation tasks.",
    config: {
      type: "cloud",
      networking: {type: "unrestricted"}
    }
  }')

environment=$(
  request_json POST "$ARK_BASE_URL/environments" \
    -H "Content-Type: application/json" \
    -d "$environment_payload"
)
ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")
echo "Environment ID: $ENVIRONMENT_ID"

# Create a Session that binds the Agent and environment.
session_payload=$(jq -n \
  --arg agent "$AGENT_ID" \
  --arg environment "$ENVIRONMENT_ID" \
  '{
    agent: $agent,
    environment_id: $environment,
    title: "Coffee campaign visual creation"
  }')

session=$(
  request_json POST "$ARK_BASE_URL/sessions" \
    -H "Content-Type: application/json" \
    -d "$session_payload"
)
SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"

# Open the event stream before sending the task.
(
  seen_running=0
  stream_error_file=$(mktemp)
  stream_result="ended"

  while IFS= read -r line; do
    [[ "$line" == data:* ]] || continue

    json="${line#data: }"
    event_type=$(jq -r '.type // empty' <<<"$json" 2>/dev/null || true)

    case "$event_type" in
      session.status_running)
        seen_running=1
        echo "[Session] running"
        ;;
      agent.tool_use)
        printf '[Tool] %s\n' "$(jq -r '.name // "unknown"' <<<"$json")"
        ;;
      agent.tool_result)
        jq -c '{type, tool_use_id, is_error}' <<<"$json"
        ;;
      agent.message)
        jq -r '.content[]? | select(.type == "text") | .text' <<<"$json"
        ;;
      session.error)
        jq . <<<"$json" >&2
        stream_result="error"
        break
        ;;
      session.status_idle)
        if [[ "$seen_running" -eq 1 ]]; then
          echo "[Session] idle"
          stream_result="idle"
          break
        fi
        ;;
    esac
  done < <(
    curl -sS -N --fail-with-body --max-time 1800 \
      "$ARK_BASE_URL/sessions/$SESSION_ID/events/stream" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      -H "Accept: text/event-stream" \
      2>"$stream_error_file"
  )

  if [[ "$stream_result" == "idle" ]]; then
    rm -f "$stream_error_file"
    exit 0
  fi

  if [[ "$stream_result" == "error" ]]; then
    rm -f "$stream_error_file"
    exit 1
  fi

  if [[ -s "$stream_error_file" ]]; then
    cat "$stream_error_file" >&2
  fi
  rm -f "$stream_error_file"
  echo "SSE stream ended before the Session returned to idle." >&2
  exit 1
) &
STREAM_PID=$!

sleep 2

task_payload=$(cat <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [
        {
          "type": "text",
          "text": "为一家城市精品咖啡品牌制作一组新品宣传素材。先生成一张 16:9 的电影感主视觉：清晨城市街角，手冲咖啡放在窗边木桌上，暖色自然光，画面中不要出现文字，并保存为 /mnt/session/outputs/campaign-key-visual.jpg。再以这张图为首帧，生成一段 4 秒、16:9 的宣传视频，镜头缓慢推进，咖啡蒸汽自然上升，并保存为 /mnt/session/outputs/campaign-teaser.mp4。完成后总结两个文件的名称和生成结果。"
        }
      ]
    }
  ]
}
EOF
)

request_json POST \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "$task_payload" >/dev/null

wait "$STREAM_PID"
STREAM_PID=""

# Wait for output registration, then download image and video files.
files='{"data":[]}'
image_count=0
video_count=0

for _ in $(seq 1 60); do
  files=$(
    request_json GET "$ARK_BASE_URL/files?scope_id=$SESSION_ID"
  )

  image_count=$(jq '[.data[]? | select((.mime_type // "") | startswith("image/"))] | length' <<<"$files")
  video_count=$(jq '[.data[]? | select((.mime_type // "") | startswith("video/"))] | length' <<<"$files")

  if [[ "$image_count" -ge 1 && "$video_count" -ge 1 ]]; then
    break
  fi

  sleep 2
done

if [[ "$image_count" -lt 1 || "$video_count" -lt 1 ]]; then
  echo "Expected image and video outputs were not registered in time." >&2
  jq . <<<"$files" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

jq -r '
  .data[]
  | select((.mime_type // "") | test("^(image|video)/"))
  | select(.download_url != null and .download_url != "")
  | [.filename, .download_url]
  | @tsv
' <<<"$files" |
  while IFS=$'\t' read -r filename download_url; do
    safe_name=$(basename "$filename")
    curl -sS --fail-with-body "$download_url" -o "$OUTPUT_DIR/$safe_name"
    echo "Downloaded: $OUTPUT_DIR/$safe_name"
  done

echo "Resources:"
echo "  AGENT_ID=$AGENT_ID"
echo "  ENVIRONMENT_ID=$ENVIRONMENT_ID"
echo "  SESSION_ID=$SESSION_ID"
```

<span id="cost-performance"></span>
## 成本和性能建议

控制成本和等待时间时，优先采用以下做法：

- 先生成一张候选图，确认主体、构图和风格后再生成视频。
- 视频草稿先使用较短时长和较低分辨率，确认镜头运动后再提高规格。
- 任务已有明确参考素材时，不要求 Agent 额外搜索，减少搜索工具调用。
- 在系统提示词中约束最终文件数量和文件名，避免重复生成无用候选。
- 使用 SSE 等待终态，不要通过重复发送消息催促任务。

<span id="next-steps"></span>
## 进阶方向

- **保持品牌视觉一致**：上传品牌图片并作为参考素材，详情请参见 [上传与挂载文件](../upload-and-mount-files.md)。
- **长期保存生成产物**：为 Environment 配置自己的 TOS Bucket，详情请参见 [配置产物存储](../configure-cloud-environment.md#configure-output-storage)。
- **控制高成本工具调用**：为图片和视频生成增加人工确认，详情请参见 [工具权限策略](../tool-permission-policy.md)。
- **提高长任务的恢复能力**：处理 SSE 断线重连和事件去重，详情请参见 [Session 事件流](../session-event-stream.md)。

<span id="cleanup"></span>
## 清理资源

确认图片和视频已经下载或转存后，按 Session、Agent、Environment 的顺序删除本教程创建的资源：

```Bash
#!/usr/bin/env bash
set -euo pipefail

: "${ARK_API_KEY:?Set ARK_API_KEY before running this script}"
: "${SESSION_ID:?Set SESSION_ID to the Session created by this tutorial}"
: "${AGENT_ID:?Set AGENT_ID to the Agent created by this tutorial}"
: "${ENVIRONMENT_ID:?Set ENVIRONMENT_ID to the Environment created by this tutorial}"

ARK_BASE_URL="${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local response_file
  local status

  response_file=$(mktemp)
  if status=$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      "$@"
  ); then
    if [[ "$status" == 2[0-9][0-9] ]]; then
      cat "$response_file"
      rm -f "$response_file"
      return 0
    fi
    printf 'HTTP %s from %s\n' "$status" "$url" >&2
  else
    printf 'Request failed before receiving an HTTP response from %s.\n' \
      "$url" >&2
  fi

  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  rm -f "$response_file"
  return 1
}

# Delete child resources before their dependencies.
request_json DELETE "$ARK_BASE_URL/sessions/$SESSION_ID" >/dev/null

request_json DELETE "$ARK_BASE_URL/agents/$AGENT_ID" >/dev/null

request_json DELETE "$ARK_BASE_URL/environments/$ENVIRONMENT_ID" >/dev/null

echo "Deleted Session, Agent, and Environment."
```

> **警告**
>
> 只删除本教程创建、且已经记录精确 ID 的资源。删除 Session 会清理方舟默认存储中的关联产物；如果 Environment 配置了自己的 TOS Bucket，删除 Session 不会删除 Bucket 中的对象。
