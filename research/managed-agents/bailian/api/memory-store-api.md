---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-store-api
fetched: 2026-10-23
title: Memory Store
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Memory Store

> 记忆库是跨会话持久化的挂载资源，内部为带路径的文件树。创建会话时挂载，智能体通过文件工具读写，内容跨会话保留。

<meta property="og:title" content="Memory Store" />

## 记忆模型 <span id="h-ms-model" />

记忆库采用三层模型：

- **记忆库（Memory Store）**：逻辑容器，含名称与描述。一个工作空间可创建多个记忆库。
- **记忆（Memory）**：记忆库内的一个文件，由路径和 UTF-8 文本正文组成，例如 Markdown 笔记。每次创建、修改、删除自动产生历史版本。
- **版本（Version）**：记忆的历史快照，可查询、可回看，支持擦除指定版本正文。

记忆库通过会话挂载使用：创建会话时在 `resources` 中指定，权限为只读（仅可检索）或读写（可写回记忆库）。挂载路径由服务端按记忆库名称生成，形如 `/mnt/memory/<名称>`。记忆库仅在创建会话时挂载，创建后不可新增、卸载或修改；需要调整时创建新会话。

## 记忆库操作 <span id="h-ms-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/memory-store-create">创建 Memory Store</a></p></td><td><p><code>POST /memory\_stores</code></p></td><td><p>创建记忆库，返回 <code>memstore\_</code> 前缀 ID</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-store-list">列出 Memory Store</a></p></td><td><p><code>GET /memory\_stores</code></p></td><td><p>按创建时间倒序分页列出，默认不含已归档</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-store-get">获取 Memory Store</a></p></td><td><p><code>GET /memory\_stores/\{memory\_store\_id}</code></p></td><td><p>获取记忆库元数据</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-store-update">更新 Memory Store</a></p></td><td><p><code>POST /memory\_stores/\{memory\_store\_id}</code></p></td><td><p>更新名称、描述与元数据</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-store-archive">归档 Memory Store</a></p></td><td><p><code>POST /memory\_stores/\{memory\_store\_id}/archive</code></p></td><td><p>归档不可逆；归档后不可写入、不能绑定新会话，已有会话的挂载变为只读</p></td></tr></tbody></table>

## 记忆操作 <span id="h-mem-ops" />

写入操作要求记忆库未归档。

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/memory-create">创建 Memory</a></p></td><td><p><code>POST /memory\_stores/\{memory\_store\_id}/memories</code></p></td><td><p>新建记忆文件，返回 <code>mem\_</code> 前缀 ID</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-list">列出 Memory</a></p></td><td><p><code>GET /memory\_stores/\{memory\_store\_id}/memories</code></p></td><td><p>按路径排序，支持路径前缀过滤；不支持按正文关键词搜索</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-get">获取 Memory</a></p></td><td><p><code>GET /memory\_stores/\{memory\_store\_id}/memories/\{memory\_id}</code></p></td><td><p>读取记忆正文；记忆库归档但未删除时可读取</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-update">更新 Memory</a></p></td><td><p><code>POST /memory\_stores/\{memory\_store\_id}/memories/\{memory\_id}</code></p></td><td><p>修改正文、重命名或同时原子修改；支持 <code>precondition</code> 乐观锁</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-delete">删除 Memory</a></p></td><td><p><code>DELETE /memory\_stores/\{memory\_store\_id}/memories/\{memory\_id}</code></p></td><td><p>删除当前文件，历史版本保留</p></td></tr></tbody></table>

## 版本操作 <span id="h-ver-ops" />

版本查询不要求当前记忆仍存在。

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/memory-version-list">列出 Memory Version</a></p></td><td><p><code>GET /memory\_stores/\{memory\_store\_id}/memory\_versions</code></p></td><td><p>按创建时间倒序，支持按记忆、操作类型与时间范围过滤</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-version-get">获取 Memory Version</a></p></td><td><p><code>GET /memory\_stores/\{memory\_store\_id}/memory\_versions/\{memory\_version\_id}</code></p></td><td><p>读取指定历史版本，用于回看旧内容，不回滚当前记忆</p></td></tr><tr><td><p><a href="/zh/model-studio/memory-version-redact">擦除 Memory Version</a></p></td><td><p><code>POST /memory\_stores/\{memory\_store\_id}/memory\_versions/\{memory\_version\_id}/redact</code></p></td><td><p>擦除指定版本正文，不可逆且不影响当前记忆</p></td></tr></tbody></table>
