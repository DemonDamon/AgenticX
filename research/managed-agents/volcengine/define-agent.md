---
source: https://ark.volcengine.com/region:cn-beijing/docs/define-agent
fetched: 2026-10-24
title: Agent
---

# Agent

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

方舟 Managed Agents 是火山方舟平台推出的全托管 Agent 服务，给您带来开箱即用的 Agent 体验。Agent 是方舟 Managed Agents 的基础元件，是一套包含基本信息、System Prompt、扩展能力（Skills、Tools、MCP 等）的配置模板，可以被任意 Session 复用，并支持版本化管理。本文介绍如何定义一个 Agent。

## Agent 版本

创建 Agent 时，先根据任务选择 Agent 版本：

- 通用 Agent：适用于代码执行、内容检索和文档处理等通用任务。
- Seedance Managed Agent：适用于图片生成、视频生成、视觉搜索和视频合成等任务。

## Agent 定义字段

Agent 的完整字段定义（包括名称、模型、System Prompt、Skills、Tools、MCP、多智能体协作、元数据等），请参见[创建智能体](api/create-agent-api.md)。

## 准备工作

1. 获取 API Key。API Key 是调用方舟平台模型和服务的鉴权信息。

    访问 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，创建你的 API Key。

2. 安装 `curl` 和 `jq`，并配置环境变量。API Key 是敏感信息，一旦意外泄露，可能会造成资金损失或安全风险，因此不要在代码中明文写入 API Key，应将其配置到环境变量中。

    将以下命令中的 `your_api_key_here` 替换为你的 API Key，并在终端中运行命令，即可将 API Key 配置到环境变量中。详见[环境变量配置指南](https://ark.volcengine.com/docs/environment-variable-configuration-guide)。

    **选项：macOS**

    ```Bash
    export ARK_API_KEY="your_api_key_here"  # gitleaks:allow
    ```

    **选项：Linux**

    ```Bash
    export ARK_API_KEY="your_api_key_here"  # gitleaks:allow
    ```

    **选项：Windows_CMD**

    ```CMD
    setx ARK_API_KEY "your_api_key_here"
    ```

    **选项：Windows_PowerShell**

    ```PowerShell
    $env:ARK_API_KEY = "your_api_key_here"  # gitleaks:allow
    ```

3. 开通 Managed Agents 服务。

    访问 [开通管理页面](https://ark.volcengine.com/region:cn-beijing/openManagement)，切换到 **Managed Agents** 页签开通服务。

4. 开通模型服务。

    访问 [开通管理](https://ark.volcengine.com/region:cn-beijing/openManagement) 页面，开通模型服务。

## 创建 Agent

创建 Agent 后，接口会返回一个稳定的 Agent ID 和初始版本号 `1`。后续创建 Session 时，可以直接引用这个 Agent ID。

单个账号最多可创建 1000 个 Agent。

下面的示例创建一个带内置工具集和自定义 Skill 的热点新闻 Agent。示例显式配置内置工具的启用状态和权限策略，并将响应中的 Agent ID 与当前版本保存到环境变量：

```Bash
AGENT_RESPONSE=$(curl -sS --fail-with-body https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "NewsAgent01",
    "model": {
      "id": "doubao-seed-2-1-pro-260628",
      "speed": "standard"
    },
    "description": "将热点新闻总结为图片的小助手。",
    "system": "你是一名热点新闻查询总结小助手，可将每天的前 10 条热点新闻以摘要图片的方式总结出来。",
    "skills": [
      {
        "type": "custom",
        "skill_id": "skill-20260812080348-****"
      }
    ],
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "default_config": {
          "enabled": true,
          "permission_policy": {
            "type": "always_allow"
          }
        }
      }
    ]
  }') || exit 1

jq . <<<"$AGENT_RESPONSE" || exit 1
AGENT_ID=$(jq -er '.id' <<<"$AGENT_RESPONSE") || exit 1
AGENT_VERSION=$(jq -er '.version' <<<"$AGENT_RESPONSE") || exit 1
export AGENT_ID AGENT_VERSION
printf 'Agent ID: %s\nAgent version: %s\n' "$AGENT_ID" "$AGENT_VERSION"
```

其中 `skill-20260812080348-****` 表示你上传自定义 Skill 后获得的 `skill_id`。

示例响应如下：

```
{
  "id": "agent-20260812081435-*****",
  "type": "agent",
  "name": "NewsAgent01",
  "description": "将热点新闻总结为图片的小助手。",
  "version": 1,
  "model": {
    "id": "doubao-seed-2-1-pro-260628",
    "speed": "standard"
  },
  "system": "你是一名热点新闻查询总结小助手，可将每天的前 10 条热点新闻以摘要图片的方式总结出来。",
  "tools": [
    {
      "type": "agent_toolset_20260916",
      "default_config": {
        "enabled": true,
        "permission_policy": {
          "type": "always_allow"
        }
      }
    }
  ],
  "skills": [
    {
      "type": "custom",
      "skill_id": "skill-20260812080348-****"
    }
  ],
  "created_at": "2026-08-12T08:14:35Z",
  "updated_at": "2026-08-12T08:14:35Z"
}
```

## 更新 Agent 与版本

Agent 是版本化资源。每次更新配置时，都需要显式传入当前版本号；如果版本号不匹配，更新会失败。更新成功后，系统会生成一个新版本。

以下示例先查询 Agent 的当前版本，再提交更新。运行本页的创建示例后，可以直接复用 `AGENT_ID`；更新其他 Agent 时，先将其 ID 写入该环境变量。

```Bash
: "${AGENT_ID:?Run the create example first or set AGENT_ID}"

CURRENT_AGENT=$(curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ARK_API_KEY") || exit 1
AGENT_VERSION=$(jq -er '.version' <<<"$CURRENT_AGENT") || exit 1

UPDATE_RESPONSE=$(curl -sS --fail-with-body -X PUT \
  "https://ark.cn-beijing.volces.com/api/v3/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
    "version": $AGENT_VERSION,
    "system": "你是一名热点新闻查询总结小助手，可将每天的前 10 条热点新闻以摘要图片和音频播报的方式总结出来。",
    "skills": [
      {
        "type": "custom",
        "skill_id": "skill-20260812075208-****"
      },
      {
        "type": "custom",
        "skill_id": "skill-20260729084811-****"
      }
    ]
}
EOF
) || exit 1

jq . <<<"$UPDATE_RESPONSE" || exit 1
AGENT_VERSION=$(jq -er '.version' <<<"$UPDATE_RESPONSE") || exit 1
export AGENT_VERSION
printf 'Updated Agent version: %s\n' "$AGENT_VERSION"
```

示例响应如下：

```
{
  "id": "agent-20260812081435-*****",
  "type": "agent",
  "name": "NewsAgent01",
  "description": "将热点新闻总结为图片的小助手。",
  "version": 2,
  "model": {
    "id": "doubao-seed-2-1-pro-260628",
    "speed": "standard"
  },
  "system": "你是一名热点新闻查询总结小助手，可将每天的前 10 条热点新闻以摘要图片和音频播报的方式总结出来。",
  "tools": [
    {
      "type": "agent_toolset_20260916",
      "default_config": {
        "enabled": true,
        "permission_policy": {
          "type": "always_allow"
        }
      }
    }
  ],
  "skills": [
    {
      "type": "custom",
      "skill_id": "skill-20260812075208-****"
    },
    {
      "type": "custom",
      "skill_id": "skill-20260729084811-****"
    }
  ],
  "created_at": "2026-08-12T08:14:35Z",
  "updated_at": "2026-08-12T08:25:21Z"
}
```

更新 Agent 时，建议关注以下规则：

- 更新请求必须带当前 `version`。
- 修改配置后会生成新的 Agent 版本。
- 更新接口返回 HTTP 400 `InvalidParameter` 且错误信息包含 `version: conflict` 时，说明其他请求已经更新了该 Agent。重新查询 Agent，合并最新配置后再提交，不要只递增本地版本号。
- 如果某些字段保持不变，可以只传需要修改的字段；例如只更新 `system` 时，不需要重复传 `tools`。
- `mcp_servers`、`tools` 和 `skills` 都使用整体替换逻辑。请求体一旦传入其中一个数组，服务端会用该数组整体覆盖对应的当前配置，不会在原有基础上追加。
- 如果只想新增或调整其中一项，先查询 Agent 的最新配置，在本地合并需要保留的条目，再把完整数组与当前 `version` 一起写回。

| 取值 | `mcp_servers`、`tools` 和 `skills` 的处理方式 | 适用场景 |
| --- | --- | --- |
| 省略或 `null` | 保留对应字段的当前配置。 | 只更新其他字段。 |
| 空数组 `[]` | 清空对应字段的已保存配置。 | 明确移除全部 MCP Server、工具或技能。 |
| 非空数组 | 使用请求中的数组整体替换当前配置。 | 先读取并合并所有需要保留的条目。 |

> **注意**
>
> 如需限制主 Agent 的内置工具范围，请显式配置内置工具集并关闭默认范围，不要通过清空 `tools` 实现。详情请参见 [核对默认工具范围](tools.md#tool-defaults-and-boundaries)。

## 设计建议

- 把稳定能力放进 Agent，把一次性任务放进 Session 事件。
- `system` 只定义角色、约束和长期规则，不要把当前任务直接写进 `system`。
- 需要外部系统能力时，优先使用 MCP。
- 需要复用领域知识或执行规范时，优先挂载 Skills，而不是把大段操作手册直接塞进 `system`。

## 相关文档

**[Skills](skills.md)**
Skills 用于给 Agent 补充领域知识、操作流程和最佳实践。

**[MCP](mcp.md)**
MCP（Model Context Protocol）用于把第三方系统的工具与数据源接入 Agent。

**[Tools](tools.md)**
Tools 决定 Agent 在 Session 中能主动调用哪些执行能力。

**[工具权限策略](tool-permission-policy.md)**
工具权限策略用于控制 Agent 发起工具调用时，是自动执行，还是暂停等待确认。
