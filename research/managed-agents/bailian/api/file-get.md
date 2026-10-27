---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/file-get
fetched: 2026-10-23
title: 查询 File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 查询 File

> 返回文件元数据（不含内容），常用于确认上传后的安全审核 status 是否已转为 available。

<meta property="og:title" content="查询 File" />

## 前提 <span id="h-fg-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-fg-endpoint" />

<strong>GET</strong> `/files/{file_id}`

返回文件元数据（`filename`、`size_bytes`、`mime_type`、`created_at`、`status`），不含内容。`scope` 字段仅在会话沙箱内部拷贝上返回。

## 状态说明 <span id="h-fg-status" />

`status` 表示安全审核结果，取值：`available`（审核通过，可挂载到会话）、`checking`（审核中）、`rejected`（内容未通过审核）、`type_rejected`（文件类型不支持）。仅 `available` 状态的文件可被挂载到会话或作为消息内容引用。

## 请求示例 <span id="h-fg-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/files/file_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  file = client.files.retrieve("file_xxx")
  print(file.filename, file.size_bytes, file.mime_type)
  ```

  ```python Python SDK
  import os
  from dashscope import Files

  # 查询文件信息（返回文件元数据，不含内容）
  result = Files.get(file_id='file-xxx', api_key=os.getenv('DASHSCOPE_API_KEY'))
  print(result)
  ```

  ```java
  AgentStudioFile f = client.files().retrieve("file_xxx");
  System.out.println(f.getFilename() + " " + f.getSizeBytes());
  ```
</CodeGroup>

## 响应示例 <span id="h-fg-resp" />

```json
{
  "id": "file_xxx",
  "type": "file",
  "filename": "sales_2025.csv",
  "downloadable": false,
  "mime_type": "text/csv",
  "size_bytes": 524288,
  "status": "available",
  "created_at": "2026-06-16T14:51:39+08:00",
  "requestId": "xxx"
}
```

响应为 File 对象。字段如下：

### 响应字段 <span id="h-fg-dto" />

| 字段             | 类型     | 说明                                                                  |
| -------------- | ------ | ------------------------------------------------------------------- |
| `id`           | string | 文件 ID，格式如 `file_kyu8k8lut4d4x47ii7qf92yk`                           |
| `type`         | string | 固定为 `file`                                                          |
| `filename`     | string | 文件名                                                                 |
| `mime_type`    | string | 服务端检测的 MIME 类型                                                      |
| `size_bytes`   | int    | 文件大小，单位字节                                                           |
| `downloadable` | bool   | 是否支持下载，当前接口直传与会话沙箱拷贝均为 `false`                                      |
| `status`       | string | 安全审核状态：`available` / `checking` / `rejected` / `type_rejected`      |
| `scope`        | object | 仅会话沙箱内部拷贝返回，结构 `{"type": "session", "id": "sesn_..."}`；普通上传文件不返回该字段 |
| `created_at`   | string | 上传时间，ISO 8601                                                       |
| `requestId`    | string | 本次请求的唯一标识                                                           |
