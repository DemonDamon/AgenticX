---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-context
fetched: 2026-10-23
title: Agent 上下文管理
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent 上下文管理

> 通过挂载资源扩展智能体在会话中可访问的数据。资源独立管理，可被多个会话复用。

<meta property="og:title" content="Agent 上下文管理" />

## 挂载资源 <span id="h-ctx-resources" />

挂载资源是上下文中唯一独立于会话管理的部分。资源通过控制台或 API 创建后，可挂载到一个或多个会话，生命周期与会话解耦。

| **资源类型**                                            | **说明**                                      |
| --------------------------------------------------- | ------------------------------------------- |
| [文件上传与挂载](managed-agents-file.md)     | 上传到平台的文件，挂载后以副本形式出现在会话沙箱的指定路径。单个文件不超过 50 MB |
| [记忆库](managed-agents-memory-store.md) | 跨会话持久化的文件树，挂载后智能体通过文件工具读写，内容跨会话保留           |

<Tip>
  通过阿里云百炼 CLI 发起会话时，也可在配置文件中声明需要挂载的资源。详见[使用 CLI](managed-agents-cli.md)。
</Tip>

## 资源与会话的关系 <span id="h-ctx-lifecycle" />

### 挂载时机 <span id="h-ctx-mount-time" />

- **创建会话时挂载**：在 `resources` 字段中指定资源列表和挂载路径。
- **运行时追加**：通过 **POST** `/sessions/{session_id}/resources` 追加，实时生效，无需重启会话。文件支持此方式；记忆库只能在创建会话时挂载，创建后不可新增、卸载或修改。

### 路径约定 <span id="h-ctx-path" />

挂载资源统一放在 `/mnt` 前缀下：

- 文件挂载在 `/mnt/session/uploads` 前缀下，路径自行填写。
- 记忆库挂载在 `/mnt/memory/<名称>`，路径由服务端按记忆库名称生成。

在系统提示词中可直接引用完整路径，智能体即可通过工具访问。

### 会话隔离 <span id="h-ctx-isolation" />

文件挂载时，平台做一份内部拷贝放入会话沙箱，会话内的修改不影响原始资源，也不影响挂载了同一资源的其他会话。记忆库不做拷贝：读写挂载的修改直接写回记忆库，供后续会话复用；只读挂载不产生修改。

## 下一步

- [文件上传与挂载](managed-agents-file.md)：上传文件并挂载到会话。
- [记忆库](managed-agents-memory-store.md)：跨会话保留智能体的工作笔记。
- [发起会话](api/session-create.md)：创建会话时指定挂载资源。
- [定义 Agent](managed-agents-agent-definition.md)：配置系统提示词和工具。
