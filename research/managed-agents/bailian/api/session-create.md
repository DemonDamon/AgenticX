---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-create
fetched: 2026-10-23
title: 创建 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Session

> 创建一个会话实例：绑定智能体与运行环境。会话创建时拍摄智能体当时最新版本的完整快照，支持会话级智能体配置覆盖与 MCP 请求头。

<meta property="og:title" content="创建 Session" />

## 前提 <span id="h-sc-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。创建会话前需先有智能体和运行环境，分别详见[Agent](agent-api.md)与[Environment](environment-api.md)。

## 接口 <span id="h-sc-endpoint" />

<strong>POST</strong> `/sessions`

## 请求体 <span id="h-sc-req" />

| 字段                      | 必填 | 类型              | 说明                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`                 | 是  | object          | 绑定的智能体引用对象，只传 `id` 即引用；可锁定版本，并按需建立会话级覆盖，见[会话级配置覆盖](#h-sc-override)                                                                                                                                                                                                                                                                     |
| `environment_id`        | 是  | string          | 绑定的运行环境 ID。环境配置预装包时创建后可能需要预热，准备中的环境不可被会话绑定（返回 invalid\_parameter），需等待预热完成                                                                                                                                                                                                                                                              |
| `title`                 | 否  | string          | 会话标题，便于在列表中辨识                                                                                                                                                                                                                                                                                                                          |
| `resources`             | 否  | array           | 创建时挂载的资源列表。文件项含 `type`（固定为 `file`）、`file_id`（已上传的文件 ID）、`mount_path`（挂载路径，必须以 `/uploads/` 开头，实际路径会加上 `/mnt/session` 前缀）；记忆库项含 `type`（固定为 `memory_store`）、`memory_store_id`、`access`（`read_only` / `read_write`，默认 `read_write`）、`instructions`（挂载说明，最长 4096 字符），挂载路径由服务端按记忆库名称生成。详见[记忆库](../managed-agents-memory-store.md) |
| `vault_ids`             | 否  | array of string | Vault ID 列表。将指定 Vault 中的 Credential 注入会话运行环境，使智能体可访问对应密钥                                                                                                                                                                                                                                                                               |
| `metadata`              | 否  | object          | 业务自定义键值，不影响模型行为                                                                                                                                                                                                                                                                                                                        |
| `environment_variables` | 否  | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取                                                                                                                                                                                                                                                                                                       |
| `mcp_configs`           | 否  | array           | 会话级 MCP 请求头，独立于 `agent`，见[会话级 MCP 请求头](#h-sc-mcp)。省略时为空数组                                                                                                                                                                                                                                                                              |

<Note>
  同一会话绑定多个 Vault 时，不同 Vault 之间的 `secret_name` 不能重复，也不要使用前缀相同的名称（例如 `API_KEY` 与 `API_KEY_V2`），否则创建会话返回 400 `invalid_parameter`（Invalid request）。
</Note>

## 请求示例 <span id="h-sc-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "agent": {"type": "agent", "id": "agent_xxx"},
      "environment_id": "env_xxx",
      "title": "Q3 销售数据分析",
      "resources": [
        {"type": "file", "file_id": "file_xxx", "mount_path": "/uploads/workspace/data.csv"}
      ],
      "vault_ids": ["vlt_xxx"],
      "metadata": {"biz_ticket_id": "1234"},
      "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"}
    }'
  ```

  ```python
  session = client.sessions.create(
      agent={"type": "agent", "id": "agent_xxx"},
      environment_id="env_xxx",
      title="Q3 销售数据分析",
      resources=[
          {"type": "file", "file_id": "file_xxx", "mount_path": "/uploads/workspace/data.csv"},
      ],
      vault_ids=["vlt_xxx"],
      metadata={"biz_ticket_id": "1234"},
      environment_variables={"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"},
  )
  print(session.id, session.status)
  ```

  ```java
  Map<String, String> metadata = new HashMap<>();
  metadata.put("biz_ticket_id", "1234");

  Map<String, String> environmentVariables = new HashMap<>();
  environmentVariables.put("API_BASE_URL", "https://api.example.com");
  environmentVariables.put("LOG_LEVEL", "info");

  Session session = client.sessions().create(SessionCreateParam.builder()
      .agent(SessionAgent.ofOverride(Map.of("type", "agent", "id", "agent_xxx")))
      .environmentId("env_xxx")
      .title("Q3 销售数据分析")
      .resources(List.of(SessionResource.builder()
          .type("file")
          .fileId("file_xxx")
          .mountPath("/uploads/workspace/data.csv")
          .build()))
      .vaultIds(List.of("vlt_xxx"))
      .metadata(metadata)
      .environmentVariables(environmentVariables)
      .build());
  System.out.println(session.getId() + " " + session.getStatus());
  ```
</CodeGroup>

## 会话级配置覆盖 <span id="h-sc-override" />

`agent` 对象可仅引用智能体，也可附带覆盖字段建立会话级覆盖：覆盖只修改本会话的配置快照，不改动智能体本身，多个会话可基于同一智能体各自定制。对象字段如下：

| 字段            | 必填 | 类型            | 说明                                                                                                      |
| ------------- | -- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `type`        | 否  | string        | `agent`（仅引用）或 `agent_with_overrides`（引用并覆盖）。携带覆盖字段时必须显式传 `agent_with_overrides`，否则返回 invalid\_parameter |
| `id`          | 是  | string        | 智能体 ID                                                                                                  |
| `version`     | 否  | integer       | 锁定的智能体版本号，省略时使用当前最新版本；版本不存在时返回 not\_found                                                               |
| `system`      | 否  | string / null | 覆盖系统提示词。省略时继承智能体源配置；空字符串明确使用空提示词                                                                        |
| `tools`       | 否  | array / null  | 覆盖工具包配置，结构与[创建 Agent](agent-create.md)的 `tools` 一致                                        |
| `mcp_servers` | 否  | array / null  | 覆盖挂载的 MCP Server 列表，结构与创建 Agent 的 `mcp_servers` 一致                                                      |
| `skills`      | 否  | array / null  | 覆盖挂载的技能列表，结构与创建 Agent 的 `skills` 一致                                                                     |

覆盖字段的取值语义（createSession 与[更新 Session](session-update.md)一致）：

| 取值               | 效果          |
| ---------------- | ----------- |
| 省略               | 继承智能体源配置    |
| `null`           | 不建立覆盖，继承源配置 |
| `[]`（数组字段）       | 明确覆盖为空      |
| `""`（仅 `system`） | 明确使用空提示词    |

## 会话级 MCP 请求头 <span id="h-sc-mcp" />

`mcp_configs` 为指定 MCP Server 的全部请求注入自定义 Header，常用于透传租户 ID、鉴权 token。每项含 `mcp_server_name`（MCP Server 名称）与 `headers`（键值对，key 与 value 均为字符串）。传入不存在的 MCP Server 名称不报错，该配置不生效。按会话动态传值的接入方法与示例见[自定义 MCP 与 Skills](../managed-agents-custom-mcp-skills.md#h-cm-dynamic-header)。

创建与更新的完整请求示例：

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "agent": {
        "type": "agent_with_overrides",
        "id": "agent_xxx",
        "system": "你是本会话专用的数据核对助手，只输出核对结论。"
      },
      "environment_id": "env_xxx",
      "mcp_configs": [
        {"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}
      ]
    }'
  ```

  ```python
  session = client.sessions.create(
      agent={"type": "agent_with_overrides", "id": "agent_xxx",
             "system": "你是本会话专用的数据核对助手，只输出核对结论。"},
      environment_id="env_xxx",
      mcp_configs=[{"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}],
  )
  ```

  ```java
  Map<String, Object> agentOverride = Map.of(
      "type", "agent_with_overrides",
      "id", "agent_xxx",
      "system", "你是本会话专用的数据核对助手，只输出核对结论。");
  Map<String, String> headers = Map.of("X-Tenant-Id", "tenant-demo");

  Session session = client.sessions().create(SessionCreateParam.builder()
      .agent(agentOverride)
      .environmentId("env_xxx")
      .mcpConfigs(List.of(Map.of(
          "mcp_server_name", "crm",
          "headers", headers)))
      .build());
  ```
</CodeGroup>

## 响应示例 <span id="h-sc-resp" />

会话详情嵌入完整的智能体快照。

```json
{
  "id": "sesn_xxx",
  "type": "session",
  "status": "idle",
  "agent": {
    "id": "agent_xxx",
    "type": "agent",
    "version": 1,
    "name": "data-analyst",
    "description": null,
    "model": {"id": "qwen3.7-max"},
    "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
    "tools": []
  },
  "environment_id": "env_xxx",
  "title": "Q3 销售数据分析",
  "resources": [
    {
      "id": "sesrsc_xxx",
      "type": "file",
      "file_id": "file_xxx",
      "mount_path": "/mnt/session/uploads/workspace/data.csv",
      "created_at": "2026-05-28T08:23:11Z",
      "updated_at": "2026-05-28T08:23:11Z"
    }
  ],
  "metadata": {"biz_ticket_id": "1234"},
  "archived_at": null,
  "created_at": "2026-05-28T08:23:11Z",
  "updated_at": "2026-05-28T08:23:11Z",
  "request_id": "xxx",
  "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"}
}
```

响应为 Session 对象。字段如下：

### 响应字段 <span id="h-sc-dto" />

| 字段                          | 类型              | 说明                                                                                                                                                                                                                                  |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | string          | 会话 ID，格式 `sesn_<ULID>`                                                                                                                                                                                                        |
| `type`                      | string          | 固定为 `session`                                                                                                                                                                                                                       |
| `status`                    | string          | 会话状态：`idle` / `running` / `terminated`。新建会话为 `idle`                                                                                                                                                                                 |
| `agent`                     | object          | 智能体配置完整快照，含 `id` / `version` / `name` / `model` / `system` / `tools` 等；会话级覆盖已并入快照                                                                                                                                                   |
| `environment_id`            | string          | 绑定的运行环境 ID                                                                                                                                                                                                                          |
| `resources`                 | array           | 挂载的资源列表。文件项含 `id`（资源 ID）、`type`、`file_id`（内部副本 ID）、`mount_path`（含前缀的完整路径）；记忆库项含 `id`、`type`、`file_id`（固定为 `null`）、`memory_store_id`、`name` / `description`（记忆库元数据）、`access`、`instructions`、`mount_path`（服务端生成，如 `/mnt/memory/<名称>`） |
| `title` / `metadata`        | string / object | 同请求体                                                                                                                                                                                                                                |
| `archived_at`               | string / null   | 归档时间，未归档时为 `null`                                                                                                                                                                                                                   |
| `created_at` / `updated_at` | string          | 创建 / 最近更新时间，ISO 8601                                                                                                                                                                                                                |
| `request_id`                | string          | 本次请求的唯一标识                                                                                                                                                                                                                           |
| `environment_variables`     | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取                                                                                                                                                                                                    |

本响应不含 `mcp_configs`；通过[获取 Session](session-get.md)查询。

## 配置锁定 <span id="h-sc-lock" />

会话创建时拍摄智能体当时最新版本的完整快照（嵌入到会话详情的 `agent` 字段）。后续编辑智能体只影响新建会话，已有会话继续使用快照中的配置。会话级配置目前仅支持通过 API 设置，控制台创建的会话为只读快照。会话创建后可继续修改会话级配置，见[更新 Session](session-update.md)。
