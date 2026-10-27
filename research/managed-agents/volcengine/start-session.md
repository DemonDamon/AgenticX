---
source: https://ark.volcengine.com/region:cn-beijing/docs/start-session
fetched: 2026-10-24
title: 启动 Session
---

# 启动 Session

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

Session 是托管 Agent 在某个 Environment 中跑某个 Agent 的一次实例。一个 Session 在多次交互中维护对话历史、保留沙箱状态，允许 Agent 跨轮次记住之前做过的事情。

启动一个 Session 分两步：

1. 创建 Session：配置沙箱、绑定 Agent 与 Environment，此时 Agent **不**开始任何工作。
2. 发送首个事件：通过 `user.message` 事件把任务交给 Agent，Session 进入 `running` 状态开始执行。

## 准备工作

开始前你需要：

- 已创建的 API Key：配置为环境变量 `ARK_API_KEY`，详情请参见 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)。
- 已创建的 Agent：详情请参见 [定义 Agent](define-agent.md)。
- 已创建的 Environment：详情请参见 [配置云环境](configure-cloud-environment.md)。

本章节示例的 Base URL 与鉴权方式详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

## 创建 Session

创建 Session 必需两个上游资源 ID：

- Agent ID：由 [定义 Agent](define-agent.md) 创建后获得，形如 `agent-20260701120000-xxxxx`。
- Environment ID：由 [配置云环境](configure-cloud-environment.md) 创建后获得，形如 `env-20260701120000-xxxxx`。

### 使用 Agent 最新版本（推荐入门）

Agent 是带版本的资源，以字符串形式传入 `agent` ID 时，Session 会用该 Agent 的**最新版本**启动。

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-20260701120000-abcde",
    "environment_id": "env-20260701120000-fghij"
  }'
```

响应返回完整的 Session 记录，其中 `id` 字段（形如 `sesn-20260701120100-xxxxx`）是后续所有操作的入口：

```json
{
  "id": "sesn-20260701120100-xxxxx",
  "type": "session",
  "status": "idle",
  "environment_id": "env-20260701120000-xxxxx",
  "agent": {
    "id": "agent-20260701120000-xxxxx",
    "type": "agent",
    "version": 3
  },
  "created_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:00:00Z",
  "resources": [],
  "vault_ids": null
}
```

响应中 `status` 为 `idle`，表示 Session 已就绪等待首个事件。完整状态包括 `initializing`、`idle`、`running`、`rescheduling`、`upgrading`、`failed` 和 `terminated`。正常轮次结束后，Session 回到 `idle`；进入 `idle` 时，平台会保存沙箱状态快照，便于后续恢复。状态机与沙箱状态保留期详情请参见 [数据保留与删除影响](manage-session.md#checkpoint-retention)。

### 固定 Agent 版本（灰度发布场景）

当你需要把 Session 锁定到 Agent 的某个具体版本（用于回滚、灰度对比、产品定版）时，以对象形式传入 `agent`，显式指定 `version`：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {"type": "agent", "id": "agent-20260701120000-abcde", "version": 1},
    "environment_id": "env-20260701120000-fghij"
  }'
```

固定版本后，即使该 Agent 后续发布了新版本，本 Session 仍按 `version: 1` 的行为运行。这让你可以分阶段灰度推出新版本，而不影响存量 Session 的行为一致性。

<span id="override-agent-config"></span>
## 覆写 Agent 配置（可选）

大多数 Session 直接传入 Agent ID 或版本引用，沿用该版本的完整配置。只有当前任务需要不同的系统提示词、模型、工具、MCP 服务、技能或多智能体协作配置时，才传入 `agent_with_overrides` 对象。

以下示例在本次 Session 中替换系统提示词和模型，将工具列表替换为内置工具集，并清空基础 Agent 的技能与 MCP 服务：

**选项：Curl**

```Bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": {
    "type": "agent_with_overrides",
    "id": "$AGENT_ID",
    "version": 1,
    "system": "你是一个代码审查助手，只报告可复现的问题并给出修改建议。",
    "model": {
      "id": "doubao-seed-2-1-pro-260915"
    },
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "name": "agent_toolset_20260916",
        "configs": [
          {
            "name": "bash",
            "enabled": true,
            "permission_policy": {
              "type": "always_allow"
            }
          }
        ],
        "default_config": {
          "enabled": false,
          "permission_policy": {
            "type": "always_allow"
          }
        }
      }
    ],
    "skills": [],
    "mcp_servers": []
  },
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Session with agent configuration overrides"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"
```

Agent 覆写遵循以下规则：

- `agent.id` 指向基础 Agent；通过可选的 `agent.version` 指定基础版本，省略时使用最新版本。
- 省略的字段沿用基础 Agent 的配置。`model` 中省略的子字段也沿用基础 Agent 的对应配置。
- `system` 和 `model` 只修改当前 Session 的智能体快照，不创建 Agent 新版本，也不影响其他 Session。
- `tools`、`mcp_servers` 和 `skills` 是完整列表覆写：传入非空数组时整体替换，传入 `[]` 时清空，省略时才沿用基础 Agent 的列表。
- `multiagent` 是完整对象覆写：省略时沿用基础 Agent 的配置；提供时，`type` 固定为 `coordinator`，`agents` 最多包含 20 项，传入 `[]` 时清空子智能体列表。
- `multiagent.agents[].type` 为 `agent` 时，填写当前账号和项目中的子 Agent ID，可通过 `version` 固定版本，省略版本时使用最新版本；设为 `self` 时复用当前主 Agent 的配置。
- 创建成功后，检查响应中的 `agent` 对象，确认本次 Session 实际保存的配置快照。
- 多智能体配置生效后，主 Agent 可把任务委派给子 Agent；平台为子 Agent 创建独立线程，并将子 Agent 的结果返回主线程。

> **注意**
>
> 不要为了表示“不修改”而给 `tools`、`mcp_servers`、`skills` 或 `multiagent.agents` 传 `[]`。空数组会清空基础 Agent 的对应列表；不需要覆写时应省略该字段。

<span id="override-environment-config"></span>
## 覆写 Environment 配置（可选）

大多数 Session 直接传入 `environment_id`，沿用 Environment 的完整运行配置。只有当前任务需要不同的依赖包、环境变量、初始化脚本或产物存储位置时，改用 `environment` 对象。

Environment 覆写遵循以下规则：

- `environment.id` 指向作为基础配置的 Environment。
- `environment.config.type` 必须与基础 Environment 的类型相同。
- `environment_id` 与 `environment` 允许同时提供，但同时提供时，`environment.id` 必须与 `environment_id` 相同，否则请求会被拒绝。
- 省略的 `config` 子字段沿用基础 Environment 的配置。提供的子字段只写入当前 Session 的环境快照，不修改原 Environment，也不影响之后创建的其他 Session。

### 覆写依赖包、环境变量和初始化脚本

需要为单个 Session 增加依赖、注入任务专用变量或执行初始化命令时，覆写 `config.packages`、`config.env` 和 `config.setup_script`：

**选项：Curl**

```Bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment": {
    "type": "environment_with_overrides",
    "id": "$ENVIRONMENT_ID",
    "config": {
      "type": "cloud",
      "packages": {
        "pip": ["pyfiglet==1.0.2"]
      },
      "env": {
        "SESSION_PROFILE": "document-analysis"
      },
      "setup_script": "mkdir -p /workspace/bootstrap && echo ready > /workspace/bootstrap/status.txt"
    }
  },
  "title": "Session with runtime configuration overrides"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"
```

- `config.packages`：配置当前 Session 启动时预装的 `pip`、`apt`、`npm`、`cargo`、`gem` 或 `go` 依赖。传入对象时整体替换基础 Environment 的依赖包配置；传入空对象 `{}` 时清空全部依赖。
- `config.env`：以字符串键值对配置当前 Session 的环境变量。传入对象时整体替换基础 Environment 的环境变量；传入空对象 `{}` 时清空全部环境变量。
- `config.setup_script`：配置当前 Session 启动时执行的 Bash 初始化脚本。传入非空字符串时替换基础 Environment 的脚本；传入空字符串 `""` 时清空。脚本在 `/workspace` 目录中运行，内容不能超过 256 KiB（262144 字节）。

> **注意**
>
> `setup_script` 超过大小限制时不会执行，脚本以非零状态码退出时也不会回滚退出前已完成的操作；这两种情况下，Session 仍可能创建成功并继续运行。让脚本写入可检查的标记文件，并在发送任务前确认依赖、目录或文件已经准备完成。

> **说明**
>
> 这些字段用于覆写 `cloud` Environment 的托管运行环境。`self_hosted` Environment 的依赖、环境变量和初始化过程由企业 Worker 管理。

创建成功后，响应中的 `environment.type` 为 `environment_with_overrides`，`environment.overridden_fields` 列出本次实际覆写的 `config` 子字段。未使用覆写对象时，`environment.type` 为 `environment`，响应不返回 `overridden_fields`。

<span id="override-output-storage"></span>
### 覆写产物存储

需要沿用 Environment 的产物存储配置时，在创建 Session 时传入 `environment_id`：

- Environment 未配置 `config.tos`：产物使用方舟公共 TOS。你需要在平台 TTL 到期前下载所需文件。
- Environment 已配置 `config.tos`：平台从 outputs 目录注册到 Files API 的产物，会写入你配置的 TOS Bucket。Files API 写入前缀为 `{prefix}outputs/{env-id}/{session-id}/`，最终对象路径以响应中的 `tos.object_key` 为准。

只有当前任务需要使用不同的 Bucket 或 `prefix` 时，改用 `environment` 对象创建 Session，并通过 `environment_with_overrides` 临时覆写 `config.tos`：

**选项：Curl**

```Bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment": {
    "type": "environment_with_overrides",
    "id": "$ENVIRONMENT_ID",
    "config": {
      "type": "cloud",
      "tos": {
        "bucket": "<TOS_BUCKET>",
        "prefix": "session-outputs/"
      }
    }
  },
  "title": "Session with output storage override"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"
```

产物存储覆写遵循以下规则：

- `config.tos` 是原子配置。传非空对象时，`bucket` 和 `prefix` 必须同时提供。
- 省略 `config.tos` 时，产物使用 Environment 中配置的存储位置；传空对象 `{}` 时，本次 Session 的产物存入方舟公共 TOS。

> **注意**
>
> 无论沿用还是覆写存储配置，都让 Agent 将交付物写入 outputs 目录，例如 `/workspace/outputs/` 或 `/mnt/session/outputs/`。`config.tos` 覆写只影响 Files API 登记后的产物存储位置，不改变 `resources` 中 `type: tos` 的沙箱挂载目录。

## 通过 Vaults 注入终端用户凭据（可选）

如果 Agent 需要在 MCP 工具、CLI、SDK 等第三方调用中使用鉴权信息（详情请参见 [使用 Vaults 认证](use-vaults-authentication.md)），创建 Session 时通过 `vault_ids` 引用预存凭据。方舟会按凭据类型注入密钥。OAuth 凭据启用自动刷新后，方舟会在访问令牌临近过期时换取新令牌。

最简示例，把 Vaults（凭据保管库）挂到 Session：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-20260701120000-abcde",
    "environment_id": "env-20260701120000-fghij",
    "vault_ids": ["vlt-20260701120000-pqrst"]
  }'
```

多个 Vaults 匹配规则、无匹配时的运行时行为、轮换与诊断，详情请参见 [使用 Vaults 认证](use-vaults-authentication.md)。

## 启动 Session：先订阅事件流，再发送第一个事件

> **注意**
>
> **创建 Session 仅完成沙箱配置，不会启动任何工作。** 必须发送 `user.message` 事件，Agent 才会开始执行。

这种解耦设计让客户端可以先注入 Vaults 凭据、检查沙箱环境，再发送首个事件启动 Agent。需要实时接收本轮事件时，按以下顺序执行：

1. 打开 `GET /sessions/{session_id}/events/stream` 事件流。
2. 等待服务端返回 `: ready`，确认订阅已经建立。
3. 向 `POST /sessions/{session_id}/events` 提交一条 `user.message`。
4. 继续读取同一条事件流，直到收到 `session.status_idle` 或 `session.status_terminated`。

> **注意**
>
> SSE 只推送连接建立后产生的事件，不回放历史事件。如果先发送消息再建立连接，客户端可能漏掉已经产生的消息、工具调用或状态事件。

以下示例需要本地已安装 `curl` 和 `jq`：

**选项：Curl**

```Bash
run_session_turn() (
  local session_id="$1"
  local user_text="$2"
  local stream_dir
  local stream_pipe=""
  local stream_error
  local stream_pid=""
  local stream_number=0
  local stream_ready=false
  local seen_ids_file
  local events_payload
  local turn_done=false
  local result_code=1
  local message_count=0
  local reconnect_count=0
  local max_reconnects="${ARK_MAX_SSE_RECONNECTS:-3}"
  local max_history_pages="${ARK_MAX_HISTORY_PAGES:-100}"
  local line
  local data

  : "${ARK_BASE_URL:?Set ARK_BASE_URL before calling run_session_turn}"
  : "${ARK_API_KEY:?Set ARK_API_KEY before calling run_session_turn}"
  : "${session_id:?Pass a Session ID as the first argument}"
  : "${user_text:?Pass a user message as the second argument}"
  command -v curl >/dev/null || {
    printf 'curl is required.\n' >&2
    return 1
  }
  command -v jq >/dev/null || {
    printf 'jq is required.\n' >&2
    return 1
  }
  [[ $max_reconnects =~ ^[0-9]+$ ]] || {
    printf 'ARK_MAX_SSE_RECONNECTS must be a non-negative integer.\n' >&2
    return 1
  }
  [[ $max_history_pages =~ ^[1-9][0-9]*$ ]] || {
    printf 'ARK_MAX_HISTORY_PAGES must be a positive integer.\n' >&2
    return 1
  }

  stream_dir=$(mktemp -d) || {
    printf 'Failed to create a temporary directory for the SSE stream.\n' >&2
    return 1
  }
  stream_error="$stream_dir/stream-error.log"
  seen_ids_file="$stream_dir/seen-event-ids"
  : >"$stream_error"
  : >"$seen_ids_file"

  stop_stream() {
    exec 3<&- || true
    if [[ -n $stream_pid ]] && kill -0 "$stream_pid" 2>/dev/null; then
      kill "$stream_pid" 2>/dev/null || true
    fi
    if [[ -n $stream_pid ]]; then
      wait "$stream_pid" 2>/dev/null || true
    fi
    if [[ -n $stream_pipe ]]; then
      rm -f "$stream_pipe"
    fi
    stream_pid=""
    stream_pipe=""
  }

  cleanup_stream() {
    stop_stream
    rm -rf "$stream_dir"
  }
  trap cleanup_stream EXIT

  start_stream() {
    stop_stream
    stream_number=$((stream_number + 1))
    stream_pipe="$stream_dir/events-$stream_number"
    stream_ready=false

    if ! mkfifo "$stream_pipe"; then
      printf 'Failed to create the SSE pipe at %s.\n' "$stream_pipe" >&2
      return 1
    fi

    curl -sS -N --fail-with-body --max-time 600 \
      "$ARK_BASE_URL/sessions/$session_id/events/stream" \
      -H "Authorization: Bearer $ARK_API_KEY" \
      -H "Accept: text/event-stream" >"$stream_pipe" 2>>"$stream_error" &
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
      if [[ -s $stream_error ]]; then
        tail -n 1 "$stream_error" >&2
      fi
      return 1
    fi
  }

  event_seen() {
    local event_id="$1"
    [[ -n $event_id ]] && grep -Fqx -- "$event_id" "$seen_ids_file"
  }

  remember_event() {
    local event_id="$1"
    if [[ -n $event_id ]] && ! event_seen "$event_id"; then
      printf '%s\n' "$event_id" >>"$seen_ids_file"
    fi
  }

  process_event() {
    local event_json="$1"
    local event_id
    local event_type
    local stop_reason
    local retry_status
    local pending_ids

    event_id=$(jq -r '.id // empty' <<<"$event_json" 2>/dev/null || true)
    if event_seen "$event_id"; then
      return 0
    fi
    remember_event "$event_id"

    event_type=$(jq -r '.type // empty' <<<"$event_json" 2>/dev/null || true)
    case "$event_type" in
      agent.message)
        jq -r '.content[]? | select(.type == "text") | .text' <<<"$event_json"
        message_count=$((message_count + 1))
        ;;
      agent.tool_use | agent.mcp_tool_use | agent.custom_tool_use)
        printf '[tool] %s\n' "$(jq -r '.name // .type' <<<"$event_json")"
        ;;
      session.error)
        retry_status=$(jq -r '.error.retry_status.type // empty' <<<"$event_json")
        printf '[error] %s: %s\n' \
          "$(jq -r '.error.type // "unknown_error"' <<<"$event_json")" \
          "$(jq -r '.error.message // "No error message returned."' <<<"$event_json")" >&2
        case "$retry_status" in
          retrying)
            printf '[session] The service is retrying automatically.\n' >&2
            ;;
          exhausted)
            printf '[session] Retries were exhausted for this turn.\n' >&2
            ;;
          terminal)
            printf '[session] The Session cannot continue after this error.\n' >&2
            ;;
          *)
            printf '[session] Unknown error retry status: %s\n' "$retry_status" >&2
            result_code=4
            turn_done=true
            ;;
        esac
        ;;
      session.status_rescheduled)
        printf '[session] The Session was rescheduled; continue waiting.\n' >&2
        ;;
      session.status_idle)
        stop_reason=$(jq -r '.stop_reason.type // empty' <<<"$event_json")
        case "$stop_reason" in
          end_turn)
            if ((message_count == 0)); then
              printf 'The turn ended without an agent.message event.\n' >&2
              result_code=5
            else
              printf '[session] end_turn\n' >&2
              result_code=0
            fi
            turn_done=true
            ;;
          requires_action)
            pending_ids=$(jq -r '.stop_reason.event_ids // [] | join(",")' <<<"$event_json")
            printf '[session] requires_action: %s\n' "$pending_ids" >&2
            result_code=2
            turn_done=true
            ;;
          retries_exhausted)
            printf '[session] retries_exhausted\n' >&2
            result_code=3
            turn_done=true
            ;;
          *)
            printf 'Unknown session.status_idle stop_reason: %s\n' "$stop_reason" >&2
            result_code=5
            turn_done=true
            ;;
        esac
        ;;
      session.status_terminated)
        printf '[session] terminated\n' >&2
        result_code=4
        turn_done=true
        ;;
    esac
  }

  read_history() {
    local mode="$1"
    local page=""
    local page_count=0
    local response
    local event_json

    while :; do
      page_count=$((page_count + 1))
      if ((page_count > max_history_pages)); then
        printf 'History recovery exceeded %s pages.\n' "$max_history_pages" >&2
        return 1
      fi

      if [[ -n $page ]]; then
        response=$(curl -sS --fail-with-body --get \
          "$ARK_BASE_URL/sessions/$session_id/events" \
          -H "Authorization: Bearer $ARK_API_KEY" \
          --data-urlencode "limit=200" \
          --data-urlencode "order=asc" \
          --data-urlencode "page=$page") || return 1
      else
        response=$(curl -sS --fail-with-body --get \
          "$ARK_BASE_URL/sessions/$session_id/events" \
          -H "Authorization: Bearer $ARK_API_KEY" \
          --data-urlencode "limit=200" \
          --data-urlencode "order=asc") || return 1
      fi

      while IFS= read -r event_json; do
        [[ -n $event_json ]] || continue
        if [[ $mode == "seed" ]]; then
          remember_event "$(jq -r '.id // empty' <<<"$event_json")"
        else
          process_event "$event_json"
          [[ $turn_done == true ]] && break
        fi
      done < <(jq -c '.data[]?' <<<"$response")

      [[ $turn_done == true ]] && return 0
      page=$(jq -r '.next_page // empty' <<<"$response")
      [[ -n $page ]] || return 0
    done
  }

  if ! start_stream; then
    return 1
  fi

  # Mark existing history so reconnect recovery only emits this turn.
  if ! read_history seed; then
    printf 'Failed to read the Session history before sending the message.\n' >&2
    return 1
  fi

  events_payload=$(jq -n --arg text "$user_text" \
    '{events: [{type: "user.message", content: [{type: "text", text: $text}]}]}')

  curl -sS --fail-with-body \
    "$ARK_BASE_URL/sessions/$session_id/events" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$events_payload" >/dev/null || return 1

  while [[ $turn_done != true ]]; do
    while IFS= read -r line <&3; do
      line=${line%$'\r'}
      if [[ $line == ": server draining, reconnect" ]]; then
        break
      fi
      [[ $line == data:* ]] || continue
      data=${line#data:}
      data=${data# }
      process_event "$data"
      [[ $turn_done == true ]] && break
    done

    [[ $turn_done == true ]] && break
    if ((reconnect_count >= max_reconnects)); then
      printf 'SSE reconnect limit reached before the turn finished.\n' >&2
      return 1
    fi

    reconnect_count=$((reconnect_count + 1))
    printf '[session] Reconnecting SSE and recovering history (%s/%s).\n' \
      "$reconnect_count" "$max_reconnects" >&2

    # Open the replacement stream first, then recover the disconnect window.
    if ! start_stream; then
      return 1
    fi
    if ! read_history recover; then
      printf 'Failed to recover Session history after reconnecting.\n' >&2
      return 1
    fi
  done

  return "$result_code"
)
```

```bash
export ARK_API_KEY="<ARK_API_KEY>"  # gitleaks:allow
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"

run_session_turn \
  "sesn-20260701120100-xxxxx" \
  "列出当前工作目录中的文件。"
```

### 响应模型与下一步

发送事件后，Session 进入 `running` 状态。上面的示例会通过已建立的 SSE 流接收消息、工具调用和状态事件，并在会话进入 `idle` 或 `terminated` 后结束监听。事件字段与断线续传方式请参见 [Session 事件流](session-event-stream.md)；若仅需轮询状态，可周期性 GET Session 详情，详情请参见 [管理 Session](manage-session.md)。
