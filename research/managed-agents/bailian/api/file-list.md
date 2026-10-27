---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/file-list
fetched: 2026-10-23
title: 列出 File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 File

> 分页列出工作空间下的文件，按 created_at 倒序返回。可通过 scope_id 仅列出某会话沙箱内的文件。

<meta property="og:title" content="列出 File" />

## 前提 <span id="h-fl-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-fl-endpoint" />

<strong>GET</strong> `/files`

## Query 参数 <span id="h-fl-q" />

| 参数         | 类型     | 默认 | 说明                         |
| ---------- | ------ | -- | -------------------------- |
| `limit`    | int    | 20 | 每页数量，最大 100                |
| `page`     | string | —  | 首次不传，后续传上一次响应的 `next_page` |
| `scope_id` | string | —  | 传入会话 ID，仅返回该会话沙箱内的文件       |

## 请求示例 <span id="h-fl-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/files?limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for file in client.files.list(limit=20):
      print(file.id, file.filename, file.size_bytes)
  ```

  ```python Python SDK
  import os
  from dashscope import Files

  # 列出已上传的文件（page 为页码，page_size 为每页数量）
  result = Files.list(page=1, page_size=10, api_key=os.getenv('DASHSCOPE_API_KEY'))
  print(result)
  ```

  ```java
  CursorPage<AgentStudioFile> page = client.files().list(
      FileListParam.builder().limit(20).build());
  for (AgentStudioFile f : page.getData()) {
      System.out.println(f.getId() + " " + f.getFilename() + " " + f.getSizeBytes());
  }
  ```
</CodeGroup>

## 响应示例 <span id="h-fl-resp" />

```json
{
  "data": [
    {
      "id": "file_xxx",
      "type": "file",
      "filename": "sales_2025.csv",
      "downloadable": false,
      "mime_type": "text/csv",
      "size_bytes": 524288,
      "status": "available",
      "created_at": "2026-06-16T14:51:39+08:00"
    },
    {
      "id": "file_xxx",
      "type": "file",
      "filename": "demo.png",
      "downloadable": false,
      "mime_type": "image/png",
      "size_bytes": 102400,
      "status": "checking",
      "created_at": "2026-06-16T14:48:02+08:00"
    }
  ],
  "next_page": "xxx",
  "requestId": "xxx"
}
```

响应包含 `data`（File 对象数组）与 `next_page`。File 对象字段如下：

### File 对象字段 <span id="h-fl-dto" />

| 字段             | 类型     | 说明                                                             |
| -------------- | ------ | -------------------------------------------------------------- |
| `id`           | string | 文件 ID，格式 `file_<24位字母数字>`                                      |
| `type`         | string | 固定为 `file`                                                     |
| `filename`     | string | 文件名                                                            |
| `mime_type`    | string | 服务端检测的 MIME 类型                                                 |
| `size_bytes`   | int    | 文件大小，单位字节                                                      |
| `downloadable` | bool   | 是否支持下载，当前接口直传与会话沙箱拷贝均为 `false`                                 |
| `status`       | string | 安全审核状态：`available` / `checking` / `rejected` / `type_rejected` |
| `created_at`   | string | 上传时间，ISO 8601                                                  |
