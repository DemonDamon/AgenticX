---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/files-api
fetched: 2026-10-23
title: File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# File

> 文件是独立资源：上传一次后可被多个会话挂载至沙箱供工具读写，也可作为消息内容（图像、音频、附件）传给智能体。

<meta property="og:title" content="File" />

## 配额与状态 <span id="h-files-quota" />

- 单文件直传上限 <strong>10 MB</strong>；单个工作空间总容量上限 <strong>100 GB</strong>；保留期 <strong>30 天</strong>，超期可能被自动清理。
- 上传后进入安全审核，`status` 取值：`checking` / `available` / `rejected` / `type_rejected`。仅 `available` 可挂载到会话或作为消息内容引用。
- 挂载到会话沙箱时服务端会做内部拷贝并生成新的 `file_id`，副本元数据带 `scope: {"type": "session", "id": "sesn_..."}`，仅对应会话可见。

## 文件操作 <span id="h-files-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/file-upload">上传 File</a></p></td><td><p><code>POST /files</code></p></td><td><p><code>multipart/form-data</code> 直传，初始状态 <code>checking</code></p></td></tr><tr><td><p><a href="/zh/model-studio/file-get">查询 File</a></p></td><td><p><code>GET /files/\{file\_id}</code></p></td><td><p>查询文件元数据与审核状态（不含内容）</p></td></tr><tr><td><p><a href="/zh/model-studio/file-download">下载 File</a></p></td><td><p><code>GET /files/\{file\_id}/content</code></p></td><td><p>返回文件的原始二进制流（仅 <code>downloadable</code> 为 <code>true</code> 的文件可下载）</p></td></tr><tr><td><p><a href="/zh/model-studio/file-list">列出 File</a></p></td><td><p><code>GET /files</code></p></td><td><p>分页列出工作空间下的文件，支持按会话 ID 过滤</p></td></tr><tr><td><p><a href="/zh/model-studio/file-delete">删除 File</a></p></td><td><p><code>DELETE /files/\{file\_id}</code></p></td><td><p>硬删除；已挂载到会话的内部拷贝不受影响</p></td></tr></tbody></table>
