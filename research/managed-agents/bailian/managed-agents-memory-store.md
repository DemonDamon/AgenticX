---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-memory-store
fetched: 2026-10-23
title: 记忆库
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 记忆库

> 记忆库是跨会话持久化的挂载资源，内部为带路径的文件树。创建会话时挂载，智能体通过文件工具读写，内容跨会话保留。

<meta property="og:title" content="记忆库" />

## 概念 <span id="h-ms-concept" />

记忆库（Memory Store）是独立于会话管理的资源，用于保存智能体的长期工作笔记：

| **层次**            | **说明**                                     |
| ----------------- | ------------------------------------------ |
| 记忆库（Memory Store） | 逻辑容器，含名称与描述。一个工作空间可创建多个记忆库                 |
| 记忆（Memory）        | 记忆库内的一个文件，由路径和 UTF-8 文本正文组成，例如 Markdown 笔记 |
| 版本（Version）       | 记忆每次创建、修改、删除时自动产生的历史版本，可查询、可回看             |

## 配额与限制 <span id="h-ms-limits" />

- 单个记忆文件最大 **102400 UTF-8 bytes**。
- 一个会话最多挂载 **8 个**记忆库。
- 一个记忆库可同时挂载到多个会话，记忆内容跨会话共享。
- 单条挂载说明最长 **4096 字符**。

## 创建记忆库 <span id="h-ms-create" />

在[记忆库](https://bailian.console.aliyun.com/managed-agent/memory-stores)页面点击**创建记忆**，填写名字和描述。名字 1～255 字符。

<Note>
  控制台提供记忆库的创建、编辑与归档。记忆文件的写入、版本查询与删除通过 API 完成，详见下文与 [Memory Store API](api/memory-store-api.md)。
</Note>

通过 API 创建，返回 `memstore_` 前缀的 ID。完整参数与响应字段详见[创建 Memory Store API](api/memory-store-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "项目知识库",
      "description": "项目约定、决策记录与排查笔记"
    }'
  ```
</CodeGroup>

## 写入与管理记忆 <span id="h-mem-manage" />

记忆文件通过 API 管理，路径以 `/` 开头，例如 `/notes/project.md`。

写入一条记忆，返回 `mem_` 前缀的 ID。完整参数与响应字段详见[创建 Memory API](api/memory-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memories" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "path": "/notes/project.md",
      "content": "# 项目约定\n默认开发环境为预发环境。\n"
    }'
  ```
</CodeGroup>

读取与修改：

- **读取**：`GET /memory_stores/{memory_store_id}/memories/{memory_id}` 返回正文；归档但未删除的记忆库仍可读取。
- **修改**：`POST /memory_stores/{memory_store_id}/memories/{memory_id}`，传入新 `content` 改正文，或传入新 `path` 重命名，也可同时传入原子修改。真实变更自动产生 `modified` 版本。
- **并发保护**：修改时可在 `precondition` 中携带读取时的 `content_sha256`，内容被他人改过则返回冲突，重读后合并重试。
- **列表**：`GET /memory_stores/{memory_store_id}/memories`，支持 `path_prefix` 前缀过滤、`depth`（0 递归 / 1 当前层）、`view`（basic 不含正文 / full 含正文）。按路径排序，不支持按正文关键词搜索。
- **删除**：`DELETE /memory_stores/{memory_store_id}/memories/{memory_id}` 删除当前文件，历史版本保留，可通过版本接口查询。

写入操作要求记忆库未归档。完整参数与响应字段详见 [Memory API](api/memory-create.md)。

## 挂载到会话 <span id="h-ms-mount" />

### 控制台 <span id="h-ms-console" />

在**新建会话**的**资源**区点击 **+**，选择**记忆**，配置以下选项后点击**创建会话**：

| **配置项** | **说明**                                     |
| ------- | ------------------------------------------ |
| 记忆      | 选择要挂载的记忆库                                  |
| 权限      | 只读（仅可检索）或读写（还可在会话结束后通过 Dreaming 把本次对话整理回库） |
| 说明      | 会随挂载信息提供给智能体，帮助其判断何时检索该记忆                  |

### API <span id="h-ms-mount-api" />

创建会话时在 `resources` 中指定，`access` 省略时默认 `read_write`：

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "agent": {"type": "agent", "id": "agent_xxx"},
      "resources": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore_xxx",
          "access": "read_write",
          "instructions": "优先查询该库中的项目约定；新发现保存到相关笔记中。"
        }
      ]
    }'
  ```
</CodeGroup>

响应的 `resources` 中返回服务端生成的 `mount_path`，例如 `/mnt/memory/<名称>`。在系统提示词中可直接引用该路径。

记忆库仅在创建会话时挂载，创建后不可新增、卸载或修改；需要调整时创建新会话。

## 智能体如何使用记忆 <span id="h-agent-usage" />

会话存在记忆挂载时，平台自动向智能体注入记忆使用说明，包含挂载路径、权限与填写的说明。智能体的使用方式：

- 通过 Glob、Grep 在挂载路径下查找，用 Read 读取相关文件，完成任务后用 Write、Edit 把值得保留的信息写回。
- 只读挂载仅支持查询与读取；读写挂载支持全部文件操作。
- shell 命令不能访问记忆路径，只能使用上述文件工具。

<Warning>
  记忆中不要保存密钥、Token 等凭证。挂载说明属于业务自定义内容，不能覆盖平台安全策略。
</Warning>

## 历史版本 <span id="h-versions" />

记忆的创建、修改、删除自动产生版本记录，版本查询不要求当前记忆仍存在：

- **列出版本**：`GET /memory_stores/{memory_store_id}/memory_versions`，可按 `memory_id` 过滤单条记忆，或按 `operation`（`created` / `modified` / `deleted`）与创建时间范围过滤，按创建时间倒序。
- **查看版本**：`GET /memory_stores/{memory_store_id}/memory_versions/{memory_version_id}` 返回该版本正文，用于回看旧内容，不回滚当前记忆。
- **擦除正文**：`POST /memory_stores/{memory_store_id}/memory_versions/{memory_version_id}/redact` 将指定版本的正文擦除，不可逆且不影响当前记忆。

完整参数与响应字段详见 [Memory Version API](api/memory-version-list.md)。

## 归档 <span id="h-ms-archive" />

在[记忆库](https://bailian.console.aliyun.com/managed-agent/memory-stores)页面点击**归档**，或调用 `POST /memory_stores/{memory_store_id}/archive`。归档不可逆：归档后不可写入，不能绑定新会话，已有会话的挂载变为只读。列表默认不返回已归档记忆库，传 `include_archived=true` 可同时返回。重复归档幂等。

## 常见错误 <span id="h-ms-errors" />

| **HTTP** | **error.code**                     | **原因**                 |
| -------- | ---------------------------------- | ---------------------- |
| 400      | `invalid_request_error`            | 参数、路径、limit、分页游标非法     |
| 401      | `InvalidApiKey`                    | API Key 缺失、错误或失效       |
| 403      | `permission_error`                 | 身份或资源访问权限不足            |
| 404      | `not_found_error`                  | 记忆库、记忆或版本不存在或不属于当前工作空间 |
| 409      | `memory_path_conflict_error`       | 文件重名或路径与已有文件/目录冲突      |
| 409      | `memory_precondition_failed_error` | 并发修改导致条件更新冲突           |
| 409      | `memory_store_archived_error`      | 对已归档记忆库发起写入            |
| 429      | `rate_limit_error`                 | 请求限流                   |

## 下一步 <span id="h-ms-next" />

- [委派任务给 Agent](managed-agents-session.md)：创建会话时挂载记忆库。
- [Agent 上下文管理](managed-agents-context.md)：了解全部挂载资源类型。
- [Memory Store API](api/memory-store-api.md)：记忆库、记忆与版本的完整接口。
