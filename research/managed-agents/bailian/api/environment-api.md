---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-api
fetched: 2026-10-23
title: Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Environment

> 运行环境定义工具调用的执行沙箱与预装依赖。环境独立于智能体管理，可被多个会话复用。

<meta property="og:title" content="Environment" />

## 生命周期 <span id="h-env-lifecycle" />

- 更新接口采用<strong>部分更新</strong>语义，传入的字段会被更新，未传字段保留原值（`config.type` 不可变；`config.packages` 与 `metadata` 传入即整体替换）；已绑定该环境的运行中会话使用绑定时的快照，不受更新影响。
- 归档为软操作，`archived_at` 被填入归档时间；归档后默认不出现在列表中，仍可被查询，已绑定会话继续可用。
- 删除为硬操作，环境配置一并清除，不可恢复。

## 环境操作 <span id="h-env-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/environment-create">创建 Environment</a></p></td><td><p><code>POST /environments</code></p></td><td><p>创建运行环境，指定沙箱类型与预装依赖</p></td></tr><tr><td><p><a href="/zh/model-studio/environment-get">获取 Environment</a></p></td><td><p><code>GET /environments/\{environment\_id}</code></p></td><td><p>获取环境详情</p></td></tr><tr><td><p><a href="/zh/model-studio/environment-list">列出 Environment</a></p></td><td><p><code>GET /environments</code></p></td><td><p>分页列出工作空间下的环境，默认不含已归档</p></td></tr><tr><td><p><a href="/zh/model-studio/environment-update">更新 Environment</a></p></td><td><p><code>POST /environments/\{environment\_id}</code></p></td><td><p>部分更新，未传字段保留原值；运行中会话使用绑定快照，不受影响</p></td></tr><tr><td><p><a href="/zh/model-studio/environment-archive">归档 Environment</a></p></td><td><p><code>POST /environments/\{environment\_id}/archive</code></p></td><td><p>软归档；默认不再出现在列表中，已绑定会话仍可用</p></td></tr><tr><td><p><a href="/zh/model-studio/environment-delete">删除 Environment</a></p></td><td><p><code>DELETE /environments/\{environment\_id}</code></p></td><td><p>硬删除；配置一并清除，不可恢复</p></td></tr></tbody></table>
