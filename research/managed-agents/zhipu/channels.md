---
source: https://docs.bigmodel.cn/cn/managed-agents/channels
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 接入聊天渠道

把已有 Agent 接入聊天渠道后，用户可以直接发送消息，平台负责创建或复用 Session、投递任务，再将回复发送回渠道。

**目前已支持飞书，近期将支持微信、企微等更多渠道。** 渠道的公开开放时间以平台公告为准。

> [!NOTE]
>
> 聊天渠道接入暂不支持控制台操作，请通过 Channel API 创建和管理。飞书渠道能力与控制台配置入口分别开放；已有 Agent 可按下列步骤接入。

## 选择接入方式

| 入口 | 用途 | 从哪里开始 |
| - | - | - |
| Channel API | 将已有 Agent 绑定到飞书机器人，由平台处理消息接收与回复 | [创建 Channel](api-reference/channel/create.md) |
| Session / Events API | 在自己的网页或应用中构建对话界面 | [快速入门](quickstart.md) |

Channel 使用固定的 Agent 版本、Environment 和资源配置。模型、工具、MCP 与 Skills 仍定义在 Agent 中，Channel 不接受这些字段的临时覆盖。

## 接入飞书

### 准备资源

1. 创建飞书应用并启用机器人和消息接收能力，完成应用发布与可用范围配置。准备 `app_id` 和 `app_secret`。
2. 准备属于当前账号的 Agent 与未归档的 Environment。创建 Channel 的账号需要目标 Agent 的 owner 权限。
3. 需要外部凭据、文件或共享记忆时，准备同一账号下的 Vault、File 或 Memory Store ID。

### 创建 Channel

Channel API 的地址与 Managed Agents API 不同，请单独配置 `FORWARD_BASE_URL`。当前 Channel v0 的 Beta 头必须包含 `managed-agents-2026-05-26`；不要直接照抄 Managed API 推荐的新 Beta 值。

```bash theme={null}
export FORWARD_BASE_URL="https://agent-api.bigmodel.cn/api/agent/forward/v0"

curl -sS "$FORWARD_BASE_URL/channels" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-05-26" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "channel_type": "feishu",
  "name": "项目助理",
  "template": {
    "agent": "$AGENT_ID",
    "environment_id": "$ENVIRONMENT_ID"
  },
  "channel_config": {
    "credentials": {
      "app_id": "$FEISHU_APP_ID",
      "app_secret": "$FEISHU_APP_SECRET"
    }
  }
}
EOF
```

将示例变量替换为你自己的值。HTTP 201 表示预检与保存成功，连接由后台异步建立；保存成功不代表机器人已经可以收发消息。接口不回显飞书凭据。

完整字段、响应示例和 Playground 见[创建 Channel API](api-reference/channel/create.md)。

### 查看连接并验证

1. 保存创建响应中的 `id`，调用[获取 Channel](api-reference/channel/get.md)，检查 `connection_status` 与 `last_error`。
2. 在飞书向机器人发送真实消息；群聊中 @ 机器人。确认回复发送到了预期对话。
3. 用 `GET /v1/sessions?agent_id=$AGENT_ID` 查找关联 Session。其 `metadata` 包含 `source_type: "im"`、`channel_id`、`channel_type` 和 `conversation_type`。随后通过 Events API 核对任务输入与执行结果。

飞书的话题是渠道对话分组；Multi Agent 的 Thread 是一个 Session 内的 Agent 执行上下文。两者的 ID 和生命周期不同。

## 配置输出与记忆

| 配置 | 默认值 | 用途 |
| - | - | - |
| `response_options.include_tool_calls` | `false` | 执行中展示工具调用进度 |
| `response_options.include_process` | `false` | 执行中展示公开过程正文 |
| `response_options.card_output` | `true` | 飞书卡片输出；`false` 只发送最终普通文本 |
| `private_memory_store_enabled` | `false` | 自动为私聊用户或群创建私有长期记忆，创建后不能修改 |
| `template.memory_stores` | `[]` | 显式挂载共享 Memory Store；与私有 Store 合计最多 8 个 |
| `group_prompt_template` | `null` | 调整群聊消息的引导模板，`null` 使用默认模板 |

输出选项位于 `channel_config.response_options`，其他渠道选项位于 `channel_config`。工具原始结果与 Thinking 不会发送到聊天渠道；最终正文取当轮最后一条非空 `agent.message`。

群聊模板必须包含 `{{context_note}}` 和 `{{messages}}` 各一次。通过[更新 Channel](api-reference/channel/update.md)只修改该模板；不支持修改 Agent、机器人凭据、名称、回复选项或私有记忆开关。需要改这些配置时，删除旧 Channel 后重新创建。

## API 与使用边界

| 操作 | API |
| - | - |
| 创建 | [创建 Channel](api-reference/channel/create.md) |
| 分页查询 | [列出 Channel](api-reference/channel/list.md) |
| 状态与详情 | [获取 Channel](api-reference/channel/get.md) |
| 修改群聊模板 | [更新 Channel](api-reference/channel/update.md) |
| 解除接入 | [删除 Channel](api-reference/channel/delete.md) |

* Agent 版本在创建 Channel 时固定。更新 Agent 后，已有 Channel 不会自动使用新版本。
* 当前 Channel 不支持外部工具结果或审批接续。使用自定义工具或 `always_ask` 导致 `requires_action` 时，该条渠道消息处理会失败；无人值守的渠道应使用可自动完成的工具。
* 删除 Channel 会停止连接与后续回复，清除机器人凭据；已创建的 Session、Memory Store 和审计记录保留。重复删除返回 404。
* 本页使用公开 Channel v0 API；不要用内部 Console 接口或操作名称替代。


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.