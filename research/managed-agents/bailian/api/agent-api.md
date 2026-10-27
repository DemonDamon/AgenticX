---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/agent-api
fetched: 2026-10-23
title: Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent

> 智能体是一份可复用的配置：模型、系统提示词、工具包、技能。每次更新自动递增版本号，会话创建时锁定当时版本。

<meta property="og:title" content="Agent" />

## 版本机制 <span id="h-agent-versioning" />

智能体使用 `version` 整数字段跟踪配置历史，行为如下：

- 更新接口采用<strong>全量替换</strong>语义，成功后 `version` 自动 +1，请求体需带当前值用作乐观锁，不一致返回 409。
- 会话创建时锁定当时 `version`，已有会话不受后续更新影响；查询历史版本通过 `GET /agents/{agent_id}?version=N`。
- 归档为软操作，`archived_at` 被填入归档时间；归档后不可用于新建会话，已有会话不受影响。

## 智能体操作 <span id="h-agent-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/agent-create">创建 Agent</a></p></td><td><p><code>POST /agents</code></p></td><td><p>创建智能体，初始 <code>version</code> 为 1</p></td></tr><tr><td><p><a href="/zh/model-studio/agent-get">获取 Agent</a></p></td><td><p><code>GET /agents/\{agent\_id}</code></p></td><td><p>默认返回最新版本；带 <code>?version=N</code> 查询历史版本</p></td></tr><tr><td><p><a href="/zh/model-studio/agent-list">列出 Agent</a></p></td><td><p><code>GET /agents</code></p></td><td><p>分页列出工作空间下的智能体，默认不含已归档</p></td></tr><tr><td><p><a href="/zh/model-studio/agent-update">更新 Agent</a></p></td><td><p><code>POST /agents/\{agent\_id}</code></p></td><td><p>全量替换；请求体需带 <code>version</code> 作乐观锁，成功后递增</p></td></tr><tr><td><p><a href="/zh/model-studio/agent-archive">归档 Agent</a></p></td><td><p><code>POST /agents/\{agent\_id}/archive</code></p></td><td><p>软归档；不可用于新建会话，已有会话不受影响</p></td></tr><tr><td><p><a href="/zh/model-studio/agent-versions">列出 Agent 版本</a></p></td><td><p><code>GET /agents/\{agent\_id}/versions</code></p></td><td><p>分页返回该智能体的全部历史版本</p></td></tr></tbody></table>
