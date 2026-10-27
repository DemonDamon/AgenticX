---
source: https://docs.bigmodel.cn/cn/managed-agents/api-reference
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# API 参考

Managed Agents API 的速查页：请求约定、全部端点与错误码。点击下表中的接口链接进入对应 API 页面，查看字段、示例与 Playground。

## 请求约定

### Base URL 与协议头

```text theme={null}
https://agent-api.bigmodel.cn/api/agent/managed
```

路径以 `/v1` 开头，例如 `POST /v1/agents`。

所有请求携带三个头。Authorization 使用智谱开放平台 API Key：

```bash theme={null}
-H "Authorization: Bearer $ZHIPUAI_API_KEY"
-H "zai-version: 2026-05-26"
-H "zai-beta: managed-agents-2026-09-22"
```

写请求另加 **content-type: application/json**。上传文件或 Skill 时改用表单（`multipart/form-data`），不要发 JSON。

需要把会话里的对话和工具内容加密落库时，创建会话再加 **x-events-encrypted: true**（只能是小写 true / false）。详见 [会话事件数据加密](events.md#会话事件数据加密)。

**/mnt/session/outputs** 始终跨轮保留。要跨轮保留沙箱系统盘（如 /workspace、/tmp 和运行期安装的软件包），创建会话再加 **x-checkpoint: true**（可选 **x-checkpoint-ttl**，1–30 天，默认 30）。详见 [跨轮保留沙箱文件](create-session.md#跨轮保留沙箱文件)。

### ID 与时间戳

资源 ID 带类型前缀，例如 **agent\_**、**env\_**、**sess\_**、**sevt\_**（事件）、**file\_**、**sesrsc\_**（会话资源）、**memstore\_**、**vlt\_**（Vault）、**vcrd\_**（凭据）、**skill\_**、**depl\_**、**drun\_**。错误响应中的 **request\_id** 以 **req\_** 开头，联系支持时请附上。时间戳统一为 RFC 3339 UTC 格式。

### 分页

大多数列表接口使用不透明游标：响应含 **next\_page**，把它作为 **page** 参数传入下一次请求；**limit** 控制页大小（各接口默认值不同）。新版 Files 列表同样返回 next\_page，page 优先；before\_id/after\_id 为兼容入口。事件列表支持 **order**（asc / desc）。

### metadata

多数资源支持 **metadata**：最多 16 个键值对，键 ≤64 字符、值 ≤512 字符，均为字符串。更新时按键级 patch：传字符串写入、传 null 删除该键、整个 metadata 传 null 清空。

### 限流

默认按组织区分读写请求：读请求突发容量 100、每秒恢复 50；写请求突发容量 20、每秒恢复 10。以下高频写接口默认使用更高的容量 100、每秒恢复 50：

* POST /v1/sessions/:sessionId/events
* POST /v1/deployments/:deploymentId/run
* POST /v1/sessions/:sessionId

平台可能按账号或接口调整限流值。收到 429 时，以响应头为准：**ratelimit-limit**、**ratelimit-remaining**、**ratelimit-reset** 和 **retry-after**；若 **x-ratelimit-scope: global**，表示平台全局容量已满。客户端应等待 retry-after 后重试。

## 端点总表

按资源列出全部接口。名称可点进对应页面看字段、示例与 Playground。

### Agents

概念说明见 [定义 Agent](agent-setup.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/agents | [创建 Agent](api-reference/agent/创建-agent.md) | 创建可复用的 Agent 配置 |
| GET | /v1/agents | [列出 Agent](api-reference/agent/列出-agent.md) | 列出你的 Agent |
| GET | /v1/agents/:agentId | [获取 Agent](api-reference/agent/获取-agent.md) | 获取当前配置 |
| POST | /v1/agents/:agentId | [更新 Agent](api-reference/agent/更新-agent.md) | 更新配置，有变化时生成新版本 |
| GET | /v1/agents/:agentId/versions | [列出 Agent 版本](api-reference/agent/列出-agent-版本.md) | 列出历史版本 |
| POST | /v1/agents/:agentId/archive | [归档 Agent](api-reference/agent/归档-agent.md) | 已有会话继续，不能再开新会话 |

### Environments

概念说明见 [配置运行环境](cloud-environment.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/environments | [创建 Environment](api-reference/environment/创建-environment.md) | 创建运行环境（软件包、网络策略） |
| GET | /v1/environments | [列出 Environment](api-reference/environment/列出-environment.md) | 列出运行环境 |
| GET | /v1/environments/<wbr />:environmentId | [获取 Environment](api-reference/environment/获取-environment.md) | 获取单个环境 |
| POST | /v1/environments/<wbr />:environmentId | [更新 Environment](api-reference/environment/更新-environment.md) | 只影响之后新建的会话 |
| POST | /v1/environments/<wbr />:environmentId/<wbr />archive | [归档 Environment](api-reference/environment/归档-environment.md) | 已有会话继续，不能再绑新会话 |
| DELETE | /v1/environments/<wbr />:environmentId | [删除 Environment](api-reference/environment/删除-environment.md) | 删除环境 |

### Sessions

概念说明见 [创建会话](create-session.md)、[管理会话](session-operations.md)、[事件与流式输出](events.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/sessions | [创建 Session](api-reference/session/创建-session.md) | 引用 Agent 与 Environment 创建会话 |
| GET | /v1/sessions | [列出 Session](api-reference/session/列出-session.md) | 按条件列出会话 |
| GET | /v1/sessions/<wbr />:sessionId | [获取 Session](api-reference/session/获取-session.md) | 获取状态、用量与配置快照 |
| POST | /v1/sessions/<wbr />:sessionId | [更新 Session](api-reference/session/更新-session.md) | 更新标题或 metadata；idle 时也可换工具 |
| POST | /v1/sessions/<wbr />:sessionId/<wbr />archive | [归档 Session](api-reference/session/归档-session.md) | 终止并只读 |
| DELETE | /v1/sessions/<wbr />:sessionId | [删除 Session](api-reference/session/删除-session.md) | 删除会话 |
| POST | /v1/sessions/<wbr />:sessionId/<wbr />events | [发送事件](api-reference/session/发送事件.md) | 发送用户消息、工具结果或打断 |
| GET | /v1/sessions/<wbr />:sessionId/<wbr />events | [列出事件](api-reference/session/列出事件.md) | 分页拉取事件历史 |
| GET | /v1/sessions/<wbr />:sessionId/<wbr />events/<wbr />stream | [订阅实时事件](api-reference/session/订阅实时事件.md) | 用 SSE 订阅实时事件 |
| POST | /v1/sessions/<wbr />:sessionId/<wbr />resources | [新增会话资源](api-reference/session/新增-session-file-resource.md) | 会话创建后追加挂载文件等资源 |
| GET | /v1/sessions/<wbr />:sessionId/<wbr />resources | [列出会话资源](api-reference/session/列出-session-resource.md) | 列出已挂载资源 |
| GET | /v1/sessions/<wbr />:sessionId/<wbr />resources/<wbr />:resourceId | [获取会话资源](api-reference/session/获取-session-file-resource.md) | 获取单个挂载资源 |
| DELETE | /v1/sessions/<wbr />:sessionId/<wbr />resources/<wbr />:resourceId | [删除会话资源](api-reference/session/删除-session-file-resource.md) | 移除挂载资源 |

### Files

概念说明见 [文件](files.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/files | [上传 File](api-reference/file/上传-file.md) | 上传文件，供会话挂载给 Agent 读 |
| GET | /v1/files | [列出 File](api-reference/file/列出-file.md) | 列出已上传和会话产出的文件 |
| GET | /v1/files/:fileId | [获取 File](api-reference/file/获取-file.md) | 获取文件元数据 |
| GET | /v1/files/:fileId/content | [下载 File 内容](api-reference/file/下载-file-内容.md) | 下载文件内容 |
| DELETE | /v1/files/:fileId | [删除 File](api-reference/file/删除-file.md) | 删除文件 |

### Memory Stores

概念说明见 [记忆](memory-stores.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/memory\_stores | [创建 Memory Store](api-reference/memory/创建-memory-store.md) | 创建跨会话的记忆库 |
| GET | /v1/memory\_stores | [列出 Memory Store](api-reference/memory/列出-memory-store.md) | 列出记忆库 |
| GET | /v1/memory\_stores/<wbr />:storeId | [获取 Memory Store](api-reference/memory/获取-memory-store.md) | 获取记忆库 |
| POST | /v1/memory\_stores/<wbr />:storeId | [更新 Memory Store](api-reference/memory/更新-memory-store.md) | 更新名称、说明或 metadata |
| POST | /v1/memory\_stores/<wbr />:storeId/<wbr />archive | [归档 Memory Store](api-reference/memory/归档-memory-store.md) | 归档后不能再挂到新会话 |
| DELETE | /v1/memory\_stores/<wbr />:storeId | [删除 Memory Store](api-reference/memory/删除-memory-store.md) | 删除记忆库及其中全部记忆 |
| POST | /v1/memory\_stores/<wbr />:storeId/<wbr />memories | [创建 Memory](api-reference/memory/创建-memory.md) | 写入一条记忆 |
| GET | /v1/memory\_stores/<wbr />:storeId/<wbr />memories | [列出 Memory](api-reference/memory/列出-memory.md) | 按路径前缀浏览记忆 |
| GET | /v1/memory\_stores/<wbr />:storeId/<wbr />memories/<wbr />:memoryId | [获取 Memory](api-reference/memory/获取-memory.md) | 读取一条记忆 |
| POST | /v1/memory\_stores/<wbr />:storeId/<wbr />memories/<wbr />:memoryId | [更新 Memory](api-reference/memory/更新-memory.md) | 更新路径或内容 |
| DELETE | /v1/memory\_stores/<wbr />:storeId/<wbr />memories/<wbr />:memoryId | [删除 Memory](api-reference/memory/删除-memory.md) | 删除一条记忆 |
| GET | /v1/memory\_stores/<wbr />:storeId/<wbr />memory\_versions | [列出 Memory Version](api-reference/memory/列出-memory-version.md) | 列出记忆的变更记录 |
| GET | /v1/memory\_stores/<wbr />:storeId/<wbr />memory\_versions/<wbr />:versionId | [获取 Memory Version](api-reference/memory/获取-memory-version.md) | 获取某次变更 |
| POST | /v1/memory\_stores/<wbr />:storeId/<wbr />memory\_versions/<wbr />:versionId/<wbr />redact | [脱敏 Memory Version](api-reference/memory/脱敏-memory-version.md) | 抹除该版本中的敏感内容，保留审计轨迹 |

### Vaults

概念说明见 [凭据管理](vaults.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/vaults | [创建 Vault](api-reference/vault/创建-vault.md) | 创建凭据集合 |
| GET | /v1/vaults | [列出 Vault](api-reference/vault/列出-vault.md) | 列出 Vault |
| GET | /v1/vaults/<wbr />:vaultId | [获取 Vault](api-reference/vault/获取-vault.md) | 获取 Vault |
| POST | /v1/vaults/<wbr />:vaultId | [更新 Vault](api-reference/vault/更新-vault.md) | 更新展示名或 metadata |
| POST | /v1/vaults/<wbr />:vaultId/<wbr />archive | [归档 Vault](api-reference/vault/归档-vault.md) | 归档 Vault |
| DELETE | /v1/vaults/<wbr />:vaultId | [删除 Vault](api-reference/vault/删除-vault.md) | 删除 Vault |
| POST | /v1/vaults/<wbr />:vaultId/<wbr />credentials | [创建 Credential](api-reference/vault/创建-credential.md) | 添加一条凭据 |
| GET | /v1/vaults/<wbr />:vaultId/<wbr />credentials | [列出 Credential](api-reference/vault/列出-credential.md) | 列出凭据，不含密钥原文 |
| GET | /v1/vaults/<wbr />:vaultId/<wbr />credentials/<wbr />:credentialId | [获取 Credential](api-reference/vault/获取-credential.md) | 获取凭据元数据 |
| POST | /v1/vaults/<wbr />:vaultId/<wbr />credentials/<wbr />:credentialId | [更新 Credential](api-reference/vault/更新-credential.md) | 轮换 token 等密钥 |
| POST | /v1/vaults/<wbr />:vaultId/<wbr />credentials/<wbr />:credentialId/<wbr />mcp\_oauth\_validate | [验证 MCP OAuth](api-reference/vault/验证-mcp-oauth.md) | 探测 MCP OAuth 凭据是否仍有效 |
| POST | /v1/vaults/<wbr />:vaultId/<wbr />credentials/<wbr />:credentialId/<wbr />archive | [归档 Credential](api-reference/vault/归档-credential.md) | 归档凭据 |
| DELETE | /v1/vaults/<wbr />:vaultId/<wbr />credentials/<wbr />:credentialId | [删除 Credential](api-reference/vault/删除-credential.md) | 删除凭据 |

### Skills

概念说明见 [Skills](skills.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/skills | [创建 Skill](api-reference/skill/创建-skill.md) | 上传自定义 Skill |
| GET | /v1/skills | [列出 Skill](api-reference/skill/列出-skill.md) | 列出 Skill |
| GET | /v1/skills/:skillId | [获取 Skill](api-reference/skill/获取-skill.md) | 获取 Skill |
| DELETE | /v1/skills/:skillId | [删除 Skill](api-reference/skill/删除-skill.md) | 删除 Skill |
| POST | /v1/skills/:skillId/versions | [创建 Skill Version](api-reference/skill/创建-skill-version.md) | 上传新版本 |
| GET | /v1/skills/:skillId/versions | [列出 Skill Version](api-reference/skill/列出-skill-version.md) | 列出版本 |
| GET | /v1/skills/:skillId/versions/:version | [获取 Skill Version](api-reference/skill/获取-skill-version.md) | 获取某个版本 |
| GET | /v1/skills/:skillId/versions/:version/content | [下载 Skill ZIP](api-reference/skill/下载-skill-zip.md) | 下载该版本的 ZIP |
| DELETE | /v1/skills/:skillId/versions/:version | [删除 Skill Version](api-reference/skill/删除-skill-version.md) | 删除某个版本 |

### Deployments

概念说明见 [定时任务](deployments.md)。

| 方法 | 路径 | 名称 | 说明 |
| :- | :- | :- | :- |
| POST | /v1/deployments | [创建 Deployment](api-reference/deployment/创建-deployment.md) | 创建定时或手动触发的任务 |
| GET | /v1/deployments | [列出 Deployment](api-reference/deployment/列出-deployment.md) | 列出定时任务 |
| GET | /v1/deployments/:deploymentId | [获取 Deployment](api-reference/deployment/获取-deployment.md) | 获取任务配置 |
| POST | /v1/deployments/:deploymentId | [更新 Deployment](api-reference/deployment/更新-deployment.md) | 更新名称、调度或初始事件 |
| POST | /v1/deployments/:deploymentId/pause | [暂停 Deployment](api-reference/deployment/暂停-deployment.md) | 暂停定时触发；手动运行仍可用 |
| POST | /v1/deployments/:deploymentId/unpause | [恢复 Deployment](api-reference/deployment/恢复-deployment.md) | 恢复定时触发 |
| POST | /v1/deployments/:deploymentId/archive | [归档 Deployment](api-reference/deployment/归档-deployment.md) | 归档后不再触发 |
| POST | /v1/deployments/:deploymentId/run | [手动运行 Deployment](api-reference/deployment/手动运行-deployment.md) | 立即触发一次运行 |
| GET | /v1/deployment\_runs | [列出 Deployment Run](api-reference/deployment/列出-deployment-run.md) | 列出运行记录 |
| GET | /v1/deployment\_runs/:runId | [获取 Deployment Run](api-reference/deployment/获取-deployment-run.md) | 获取单次运行结果 |

## 错误处理

常规错误响应使用下列信封，包含 **error.type**、**error.message** 与 **request\_id**；HTTP 状态码表示错误类别：

```json theme={null}
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "environment_id: value is required"
  },
  "request_id": "req_xxxxxxxxxxxx"
}
```

| HTTP | error.type | 典型场景 |
| - | - | - |
| 400 / 422 | invalid\_request\_error | 参数非法、字段不支持、缺少必填字段 |
| 401 | authentication\_error | 缺少或无法解析凭据 |
| 403 | permission\_error | 身份可识别但权限不足 |
| 404 | not\_found\_error | 资源不存在或对调用者不可见 |
| 409 | invalid\_request\_error | 版本冲突、资源状态冲突、唯一键冲突（无独立 conflict 类型，结合状态码与 message 区分） |
| 413 | request\_too\_large | 请求体超限 |
| 429 | rate\_limit\_error | 配额或请求频率超限 |
| 500 | api\_error | 内部错误 |
| 504 | timeout\_error | 请求或上游处理超时 |
| 502 / 503 / 529 | overloaded\_error | 上游不可用或服务过载 |

读取请求遇到 429 与 5xx 可按 Retry-After 或指数退避重试；400 类错误应先修正请求。创建资源、提交 Event 等写请求结果未知时，先核对已有资源或历史，不要直接重复提交。会话内的异步失败不走 HTTP 错误，而是以 **session.error** 事件送达，见[事件与流式输出](events.md)。

## 协议与补充资源

本页和 Playground 默认使用新 beta header。旧协议继续兼容；effort、Skill、Files、Thinking、创建成功状态码等差异见[协议版本](protocol-versions.md)。

### Threads

| 方法 | 路径 | 用途 |
| - | - | - |
| GET | `/v1/sessions/:sessionId/threads` — [字段与示例](api-reference/session/threads/列出会话线程.md) | 列出线程（含主线程），支持 statuses\[] |
| GET | `/v1/sessions/:sessionId/threads/:threadId` — [字段与示例](api-reference/session/threads/获取会话线程.md) | 线程详情 |
| POST | `/v1/sessions/:sessionId/threads/:threadId/archive` — [字段与示例](api-reference/session/threads/归档会话线程.md) | 归档 idle 子线程 |
| GET | `/v1/sessions/:sessionId/threads/:threadId/events` — [字段与示例](api-reference/session/threads/列出线程事件.md) | 分页读取完整历史 |
| GET | `/v1/sessions/:sessionId/threads/:threadId/stream` — [字段与示例](api-reference/session/threads/订阅线程实时事件.md) | 独立 live-only SSE |

### Skill 与仓库补充端点

| 方法 | 路径 | 用途 |
| - | - | - |
| GET | /v1/skills/:id/versions/latest | 读取 head SkillVersion |
| POST | /v1/sessions/:sessionId/resources/:resourceId | 仅轮换 github\_repository authorization\_token |

完整用法见[会话线程](threads.md)、[Agent Skills](skills.md)、[访问 GitHub 仓库](github-repository.md)。仓库不能后续追加/删除，Deployment 不接受仓库资源。

### 控制台接入边界

[聊天渠道](channels.md)提供公开 Channel v0 的接入步骤；控制台 `/v1/console/*` 是另一套接口，不应替代公开 Channel API。

创建普通 Session 不需要先启用所有可选能力。新客户端只按自己需要的页配置工具、Skills、仓库、Memory 或 Deployment。

## Channel API

聊天渠道通过 Forward Channel v0 管理，使用独立 Base URL 和 Beta 请求头，不属于 `/v1/sessions` 的子资源。目前支持飞书，微信、企微等渠道近期支持。接入步骤见[接入聊天渠道](channels.md)。

| 方法 | 接口 | 用途 |
| - | - | - |
| POST | [创建 Channel](api-reference/channel/create.md) | 绑定固定的 Agent 版本与飞书机器人 |
| GET | [列出 Channel](api-reference/channel/list.md) | 分页读取当前账号的渠道 |
| GET | [获取 Channel](api-reference/channel/get.md) | 查看连接状态、配置与错误 |
| PATCH | [更新 Channel](api-reference/channel/update.md) | 仅修改群聊 Prompt 模板 |
| DELETE | [删除 Channel](api-reference/channel/delete.md) | 停止接入并清理机器人凭据 |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.