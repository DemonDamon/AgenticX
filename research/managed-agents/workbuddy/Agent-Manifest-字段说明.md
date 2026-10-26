---
source: https://www.workbuddy.cn/docs/enterprise/224749125734146048
fetched: 2026-10-23
title: Agent Manifest 字段说明
---

## 概述

Manifest 是 Agent 的版本级能力声明，以 JSON 对象形式随接口提交，用于描述该版本具备的系统提示词、技能、专家能力、MCP 服务与行为元数据。

v2.0 协议具有以下特点：
- **强类型与严格校验**：结构非法、超出大小限制或字段取值超出值域时整体拒绝，不会部分生效。

- **引用式资源**：skills / experts 仅声明 `type + id + version`，对应资源的下载地址由系统解析补齐，调用方无需指定。

- **凭据不落明文**：不支持在 Manifest 中提交明文凭据，MCP 服务鉴权由系统在运行时统一完成。

- **未知顶层键静默丢弃**：协议外的顶层字段不会触发报错，也不会被保留，请勿依赖该行为传递数据。

## 数据结构

### 顶层字段

|字段|类型|必填|说明|
|---------|---------|---------|---------|
|`version`|string|是|固定为 `"2.0"`。未显式填写时由系统自动注入|
|`system_prompt`|string|否|系统提示词，定义 Agent 的角色设定与行为约束|
|`skills`|array<SkillRef>|否|技能引用列表|
|`experts`|array<ExpertRef>|否|专家能力引用列表，结构与 SkillRef 相同|
|`mcp_servers`|array<MCPServer>|否|外部 MCP 服务声明|
|`subagents`|array|否|预留字段。仅要求语法上为数组，当前无业务语义|
|`metadata`|object|否|自由键值对形式的行为元数据，例如 `welcome_message`、`suggested_questions`|

> **注意：**
> 
> 顶层必须为 JSON object；数组、标量或 null 将被整体拒绝。
> 

### skills / experts 条目（SkillRef / ExpertRef）

每个条目的结构如下：
``` json
{
  "type": "builtin",
  "id": "skill_2108966609670115328",
  "version": "1.2.0",
  "auth_enterprise_id": "fyfq9rkft8n4"
}
```

|字段|类型|必填|说明|
|---------|---------|---------|---------|
|`type`|string|是|取值范围：`builtin`（平台内置）/ `custom`（本企业自建）/ `authorized`（跨企业授权引用）|
|`id`|string|是|资源 ID，不能为空。取值与 Web 端对应资源详情中显示的 ID 一致：技能形如 `skill_2108966609670115328`，专家形如 `ex_3LpzJRabpekC`|
|`version`|string|否|缺省时视为最新版本（latest）|
|`auth_enterprise_id`|string|否|仅 `authorized` 类型使用。绑定的云下 WorkBuddy 企业对应的企业 ID，形如 `fyfq9rkft8n4`|

### mcp_servers 条目（MCPServer）

每个条目的结构如下：
``` json
{
  "name": "my-search",
  "url": "https://mcp.example.com/search",
  "transport": "sse",
  "protocolVersion": "2025-03-26"
}
```

|字段|类型|必填|说明|
|---------|---------|---------|---------|
|`name`|string|是|服务名称，不能为空|
|`url`|string|是|服务地址，不能为空|
|`transport`|string|否|取值范围：`http`（缺省，Streamable HTTP）/ `sse`。SSE 端点必须显式声明 `sse`，否则运行时按 Streamable HTTP 握手会失败。`streamable-http`、`streamable_http` 等历史写法在保存时自动归一为 `http`|
|`protocolVersion`|string|否|MCP 协议版本|

> **注意：**
> 
> 不支持 `headers` / `env` 字段，携带这两个字段的输入在校验阶段直接拒绝；MCP 服务不支持提交明文凭据，鉴权由系统统一管理。
> 

### metadata

`metadata` 为自由键值对，系统不校验其内容，可用于存放 `welcome_message`（欢迎语）、`suggested_questions`（建议问题列表）等自定义行为数据。

> **注意：**
> 
>  以下键由系统管理，提交时会被覆盖或剥离，请勿设置：`model`（由版本级 Model 参数管理）、`description`（由接口独立字段管理）、`agentName`（系统注入）。
> 

## 校验规则

创建或更新 Agent 及版本时，Manifest 按以下规则校验，任一项失败则整体拒绝：
1. **大小**：序列化后不超过 256 KiB。

2. **结构**：顶层为 JSON object。

3. **version**：必须为 `"2.0"`（缺省时自动注入后等效满足）。

4. **skills / experts**：每一项 `type` ∈ {`builtin`, `custom`, `authorized`} 且 `id` 非空。

5. **mcp_servers**：每一项 `name`、`url` 非空，且不携带 `headers` / `env`。

6. **subagents**：语法上必须为数组。

7. **metadata**：自由键值对，不做内容校验。

   校验失败的错误信息格式为 `manifest.<field>: <message>`，例如：

   ``` plaintext
   manifest.mcp_servers[0].url: is required
   manifest.skills[1].type: must be one of [builtin,custom,authorized], got "foo"
   ```

   > **注意：**
   > 
   > 请勿通过 Manifest 传递密钥、账号口令等敏感数据。MCP 服务鉴权由系统统一管理；其余运行时配置由系统自动注入，无需在 Manifest 中声明。
   > 

## 示例

以下为一个完整的 Manifest 示例：
``` json
{
  "version": "2.0",
  "system_prompt": "你是一个数据分析助手。",
  "skills": [
    { "type": "builtin", "id": "skill_2108966609670115328", "version": "1.0.0" },
    { "type": "custom", "id": "skill_2187654321098765432" },
    { "type": "authorized", "id": "skill_2209876543210987654", "auth_enterprise_id": "fyfq9rkft8n4" }
  ],
  "experts": [
    { "type": "builtin", "id": "ex_3LpzJRabpekC", "version": "1.0.0" }
  ],
  "mcp_servers": [
    {
      "name": "my-search",
      "url": "https://mcp.example.com/search",
      "transport": "sse"
    }
  ],
  "metadata": {
    "welcome_message": "你好，我可以帮你做数据分析",
    "suggested_questions": ["分析这份 CSV", "生成周报"]
  }
}
```

