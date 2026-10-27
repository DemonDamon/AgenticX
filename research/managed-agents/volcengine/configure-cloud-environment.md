---
source: https://ark.volcengine.com/region:cn-beijing/docs/configure-cloud-environment
fetched: 2026-10-24
title: 配置云环境
---

# 配置云环境

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍如何为方舟 Managed Agents 创建和管理云端沙箱环境，包括预装依赖包、环境变量、启动脚本和产物存储。

**Environment** 描述 Agent 运行时使用的沙箱模板。一个 Environment 可以被多个 Session 复用，但每个 Session 会启动独立的沙箱实例，文件系统状态彼此隔离。

Managed Agents 同时支持云环境和自托管环境。本页只介绍由方舟管理沙箱的云环境。如果你需要在企业基础设施中执行工具或访问内网资源，选择自托管环境，详情请参见 [自托管环境概述](self-hosted-environment-overview.md)。

<span id="create-environment"></span>
## 创建环境

你可以在控制台的 [Environments](https://ark.volcengine.com/region:cn-beijing/managed-agents/environments?projectName=default) 页面创建 Environment，也可以使用 API 创建。

在控制台单击 **创建 Environment**，按需配置以下内容：

- 类型：选择云托管环境。
- 预装包：配置沙箱启动前安装的系统包和语言依赖。
- 环境变量：配置注入沙箱进程的非敏感键值对。
- 初始化脚本：配置沙箱启动阶段执行的脚本。
- 产物存储：可选。需要长期保留 Agent 产物时，选择自己的 TOS 目录；不选择时使用方舟公共 TOS。

> **说明**
>
> 创建 Environment 时使用清晰且唯一的名称，便于区分开发、测试和生产等不同用途。

参考以下示例代码，使用 API 创建环境：

```bash
environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {
      "type": "unrestricted"
      },
    "packages": {
      "pip": ["pandas"],
      "apt": ["curl"]
    },
    "env": {
      "MY_KEY_0": "value_0",
      "MY_KEY_1": "value_1"
    }
  }
}
EOF
)

ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")

echo "Environment ID: $ENVIRONMENT_ID"
```

主要配置项：

- `name`：Environment 名称，在当前项目内需要唯一。
- `description`：Environment 的说明信息。
- `config.type`：运行环境类型，云托管环境取值为 `cloud`。
- `config.networking.type`：沙箱的出站网络访问策略。`unrestricted` 允许完整出站网络访问，但仍受通用安全拦截列表限制。
- `config.packages`：沙箱启动前预安装的依赖包。依赖会在使用同一 Environment 的 Session 之间缓存。若同时配置多个包管理器，系统按 `apt`、`cargo`、`gem`、`go`、`npm`、`pip` 的顺序执行。依赖版本可以显式锁定，未指定版本时安装最新版本。

  | 字段 | 包管理器 | 示例 |
  |------|----------|------|
  | `apt` | 系统包（apt-get） | `"ffmpeg"` |
  | `cargo` | Rust（cargo） | `"ripgrep@14.0.0"` |
  | `gem` | Ruby（gem） | `"rails:7.1.0"` |
  | `go` | Go modules | `"golang.org/x/tools/cmd/goimports@latest"` |
  | `npm` | Node.js（npm） | `"express@4.18.0"` |
  | `pip` | Python（pip） | `"pandas==2.2.0"` |

- `config.env`：注入沙箱进程的环境变量。需要让 Agent 读取非敏感业务参数时配置，例如时区或服务地址。
- `config.setup_script`：沙箱启动阶段执行的初始化脚本。需要在每次启动沙箱时准备目录、下载资源或执行自定义初始化命令时配置。
- `config.tos`：Agent 最终产物的 TOS 存储位置。需要长期保留 Agent 生成的报告、文件或代码时配置；不配置时产物使用方舟公共 TOS。

<span id="configure-output-storage"></span>
## 配置产物存储

需要将产物长期保存在自己的 TOS Bucket 时，为 Environment 配置 `config.tos`；继续使用方舟公共 TOS 时，省略该字段。`config.tos` 控制平台将 outputs 产物注册到 Files API 时使用的持久化位置，不等同于 `resources` 中 `type: tos` 的沙箱挂载目录。

| 你的配置 | 产物位置 | 你需要做什么 |
| --- | --- | --- |
| 不配置 `config.tos` | 方舟公共 TOS | 在平台 TTL 到期前下载所需文件。删除 Session 时，平台会清理默认存储中的关联产物。 |
| 配置 `config.tos` | 你的 TOS Bucket。平台从 outputs 目录注册产物时，Files API 写入前缀为 `{prefix}outputs/{env-id}/{session-id}/`；最终对象路径以响应中的 `tos.object_key` 为准 | 在 TOS 中管理对象生命周期。删除 Session 不会删除 Bucket 中的对象。 |

将产物写入自己的 TOS Bucket 时，需要满足以下条件：

- 目标 Bucket 已在方舟项目中完成授权，详情请参见 [用户对象存储（TOS）授权](https://ark.volcengine.com/docs/project-configuration#4eb1b277)。
- Bucket 与 Managed Agents 服务须部署在同一地域，跨地域 Bucket 会在预检查阶段被拒绝。
- `bucket` 和 `prefix` 必须同时提供，不能只配置其中一个字段。
- `prefix` 使用相对路径，例如 `ark-files/`。
- 平台从 outputs 目录注册产物时，会在该前缀后追加 `outputs/{env-id}/{session-id}/` 作为 Files API 写入前缀。最终对象路径以响应中的 `tos.object_key` 为准，通常还会包含 `ark_processed/{file_id}/{file_type}/{filename}`。
- 直接调用 Files API 并传入 `tos[prefix]` 时，不会追加 Environment ID 或 Session ID，但 Files API 仍会在该前缀下生成服务侧处理目录。

以下示例演示创建带产物存储的 Environment、更新存储位置，以及清空配置，使后续 Session 改用方舟公共 TOS：

```Bash
# Create an environment that stores outputs in your TOS bucket.
environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {
      "type": "unrestricted"
    },
    "tos": {
      "bucket": "<TOS_BUCKET>",
      "prefix": "ark-files/"
    }
  }
}
EOF
)

ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")
echo "Environment ID: $ENVIRONMENT_ID"
# Example output: Environment ID: env-20260723142038-xxxxx

# Replace the output storage configuration for future sessions.
updated_environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "config": {
    "tos": {
      "bucket": "<NEW_TOS_BUCKET>",
      "prefix": "new-prefix/"
    }
  }
}
EOF
)

jq '{id, tos: .config.tos}' <<<"$updated_environment"
# Example output:
# {
#   "id": "env-20260723142038-xxxxx",
#   "tos": {"bucket": "<NEW_TOS_BUCKET>", "prefix": "new-prefix/"}
# }

# Clear the configuration so future sessions use the default storage.
cleared_environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "config": {
        "tos": {}
      }
    }'
)

jq '{id, tos: (.config.tos // null)}' <<<"$cleared_environment"
# Example output:
# {
#   "id": "env-20260723142038-xxxxx",
#   "tos": null
# }
```

> **注意**
>
> 先更新 Environment，再创建需要使用新存储配置的 Session。已有 Session 使用创建时冻结的配置快照，不会自动切换到新的 Bucket 或 `prefix`。

<span id="use-environment"></span>
## 在 Session 中使用环境

创建 Environment 后，在创建 Session 时传入 `environment_id`，即可复用该 Environment 的运行配置和产物存储配置。

```bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Quickstart session"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")

echo "Session ID: $SESSION_ID"
```

如果只有某次任务需要使用不同的产物存储位置，可以在创建 Session 时使用 Environment 覆写，不需要修改可复用的 Environment。详情请参见 [覆写产物存储](start-session.md#override-output-storage)。

<span id="environment-lifecycle"></span>
## 环境生命周期

- 多个 Session 可以引用同一个环境，但每个 Session 都会获得独立的沙箱实例。
- Session 之间不共享文件系统状态。
- 环境本身不做版本化管理。如果你频繁更新环境配置，建议在业务侧记录变更，以便追溯某个 Session 使用的是哪一版环境。
- Environment 被 `idle` 或 `running` 状态的 Session 引用时不能删除。删除前，先终止或删除这些 Session；其他状态的 Session 不会阻止删除 Environment。

<span id="manage-environment"></span>
## 管理环境

你可以列出、查看、更新或删除 Environment。

```bash
# List environments
environments=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments" \
    -H "Authorization: Bearer $ARK_API_KEY"
)

# Retrieve a specific environment
environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
    -H "Authorization: Bearer $ARK_API_KEY"
)

# Update environment description
environment=$(
  curl -sS --fail-with-body -X POST "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "description": "<UPDATED_ENVIRONMENT_DESC>"
}
EOF
)

# Delete an environment (only if no sessions reference it)
curl -sS --fail-with-body -X DELETE \
  "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

<span id="preinstalled-runtimes"></span>
## 预置运行时

云沙箱默认包含常见语言运行时、数据库和工具。需要确认具体内置版本、目录用途或完整清单时，详情请参见 [云沙箱参考](cloud-sandbox-reference.md)。
