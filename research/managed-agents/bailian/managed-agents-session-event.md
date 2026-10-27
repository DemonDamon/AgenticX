---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-session-event
fetched: 2026-10-23
title: 发起会话
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 发起会话

> 会话承载智能体的一次运行实例，全部消息、工具调用与状态变更以事件形式实时记录。

<meta property="og:title" content="发起会话" />

## 会话（Session） <span id="0daf2cd71e8dd" />

会话是智能体的一次运行实例，承载多轮消息、工具调用与状态变更。控制台**新建会话**用于调试；生产环境通过 API 创建与驱动，详见 [Session API](api/session-api.md)。

### 新建会话 <span id="session-create" />

在智能体详情页点击**新建会话**，绑定运行环境（必选）后进入会话页面。创建时服务端快照当时的智能体配置，后续编辑智能体不影响已有会话。

通过 API 创建会话时，需绑定智能体与运行环境，服务端自动快照当前智能体配置。完整参数与响应字段详见[创建 Session API](api/session-create.md)。

绑定的环境配置了预装包时，需等待预热完成，准备中的环境无法创建会话，详见[环境预热](managed-agents-cloud-hosting.md#h-env-warmup)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "agent": {"type": "agent", "id": "agent_xxx"},
      "environment_id": "env_xxx",
      "title": "Q3 销售数据分析",
      "resources": [
        {"type": "file", "file_id": "file_xxx", "mount_path": "/workspace/data.csv"}
      ]
    }'
  ```

  ```python
  session = client.sessions.create(
      agent={"type": "agent", "id": "agent_xxx"},
      environment_id="env_xxx",
      title="Q3 销售数据分析",
      resources=[
          {"type": "file", "file_id": "file_xxx", "mount_path": "/workspace/data.csv"},
      ],
  )
  print(session.id, session.status)
  ```

  ```java
  Session session = client.sessions().create(SessionCreateParam.builder()
      .agent(SessionAgent.ofOverride(Map.of("type", "agent", "id", "agent_xxx")))
      .environmentId("env_xxx")
      .title("Q3 销售数据分析")
      .resources(List.of(SessionResource.builder()
          .type("file")
          .fileId("file_xxx")
          .mountPath("/workspace/data.csv")
          .build()))
      .build());
  System.out.println(session.getId() + " " + session.getStatus());
  ```
</CodeGroup>

### 会话级配置与 MCP 请求头 <span id="session-override" />

创建会话时通过 `agent` 对象可覆盖本会话的系统提示词、工具、MCP Server 与技能，只传 `id` 则仅引用智能体；`mcp_configs` 为指定 MCP Server 的全部请求注入自定义 Header（如租户 ID、鉴权 token）。覆盖只作用于本会话，不改动智能体本身。

<Note>
  会话级配置目前仅支持通过 API 设置；控制台创建的会话为只读快照，在会话页面的**智能体**标签页查看。
</Note>

覆盖语义与完整字段见[创建 Session API](api/session-create.md)；会话创建后可继续修改，见[管理会话](managed-agents-session-operations.md)。

### 会话页面布局 <span id="event-panel" />

- **事件面板**：实时展示当轮的处理过程。左上角下拉框可按类型筛选事件（All events / User / Agent / Tool / Tool\_output / Error / Model / System）。
- **右侧标签页**：**智能体**、**环境**、**环境变量**、**记忆**、**文件**、**密钥库**标签页，分别查看当前会话快照的配置；**记忆**展示会话挂载的记忆资源。
- **输入区**：底部输入框输入消息，点击**发送**提交；处理中可点击**中断**停止当前轮。

### 挂载资源 <span id="resource-mount" />

在会话页面的**资源**区上传或挂载已有文件，智能体在工具调用中按 `mount_path` 读写。详见[文件上传与挂载](managed-agents-file.md)。运行时也可通过 API 动态挂载、查询与卸载文件资源，详见 [Session API](api/session-api.md)。

记忆库在创建会话时于**资源**区点击 **+** 挂载，配置记忆库、权限与说明；创建后不可新增、卸载或修改。详见[记忆库](managed-agents-memory-store.md)。

### 归档与删除 <span id="a1b854f16dtaq" />

会话支持归档和删除两种操作：

- **归档**：状态变为 `terminated`（终态），事件历史保留可查。适用于已完成的会话。
- **删除**：硬删除，会话元数据、事件历史、内部拷贝的资源全部清除，不可恢复。如需保留事件历史请改用归档。

## 下一步

- [管理会话](managed-agents-session-operations.md)：了解状态机、工具调用流程与归档删除。
- [会话事件流（SSE）](managed-agents-event-stream.md)：了解全部事件类型与 SSE 订阅。
- [Session API](api/session-api.md)：用 API 创建会话、发消息、订阅事件流。
