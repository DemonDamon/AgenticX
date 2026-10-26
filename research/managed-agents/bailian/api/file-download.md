---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/file-download
fetched: 2026-10-23
title: 下载 File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 下载 File

> 下载文件内容，直接返回文件的原始二进制流（不返回 JSON，也不返回预签名 URL）。响应带 Content-Type（随文件实际类型返回）与 Content-Length 头。 仅 downloadable 为 true 的文件可下载；当前接口直传与会话沙箱拷贝的文件 downloadable 均为 false，调用会返回 400。

<meta property="og:title" content="下载 File" />

## 前提 <span id="h-download-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-download-endpoint" />

<strong>GET</strong> `/files/{file_id}/content`

## 路径参数 <span id="h-download-path" />

| **参数**    | **必填** | **类型** | **说明** |
| --------- | ------ | ------ | ------ |
| `file_id` | 是      | string | 文件 ID  |

## 请求示例 <span id="h-download-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/files/file_xxx/content" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-download-resp" />

成功，返回文件原始二进制流。

## 错误码 <span id="h-download-err" />

| **状态码** | **错误码**                 | **说明**                         |
| ------- | ----------------------- | ------------------------------ |
| 400     | `invalid_request_error` | File '...' is not downloadable |
| 401     | `InvalidApiKey`         | Invalid API-key provided.      |
| 404     | `not_found_error`       | File not found.                |
