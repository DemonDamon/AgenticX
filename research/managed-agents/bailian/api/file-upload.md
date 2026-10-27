---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/file-upload
fetched: 2026-10-23
title: 上传 File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 上传 File

> 使用 multipart/form-data 上传单个文件，最大 50 MB。上传后进入安全审核，available 状态才可挂载或作为消息内容。

<meta property="og:title" content="上传 File" />

## 前提 <span id="h-fu-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 配额与限制 <span id="h-fu-quota" />

- 单个工作空间下文件总容量上限为 <strong>100 GB</strong>。
- 文件保存时效为 <strong>30 天</strong>，超过 30 天的文件不保证可用，可能被自动清理。需要长期保留请定期重新上传。
- 通过该接口直传的单个文件最大 <strong>50 MB</strong>。

## 接口 <span id="h-fu-endpoint" />

<strong>POST</strong> `/files`

使用 `multipart/form-data` 编码。`filename` 自动从表单部分获取，`mime_type` 由服务端检测。

## 请求示例 <span id="h-fu-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/files" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -F "file=@./sales_2025.csv"
  ```

  ```python
  file = client.files.upload("sales_2025.csv")
  print(file.id)
  ```

  ```python Python SDK
  import os
  from dashscope import Files

  # 上传文件（purpose='fine_tune' 用于微调训练文件，purpose='inference' 用于推理临时文件）
  result = Files.upload(
      file_path='sales_2025.csv',
      purpose='fine_tune',
      api_key=os.getenv('DASHSCOPE_API_KEY'),
  )
  print(result)
  ```

  ```java
  AgentStudioFile file = client.files().upload(Paths.get("sales_2025.csv"), "text/csv");
  System.out.println(file.getId());
  ```
</CodeGroup>

## 响应示例 <span id="h-fu-resp" />

```json
{
  "id": "file_xxx",
  "type": "file",
  "filename": "sales_2025.csv",
  "downloadable": false,
  "mime_type": "text/csv",
  "size_bytes": 524288,
  "status": "checking",
  "created_at": "2026-06-16T14:51:39+08:00",
  "requestId": "xxx"
}
```

响应为 File 对象。字段如下：

### 响应字段 <span id="h-fu-dto" />

| 字段             | 类型     | 说明                                                                                                           |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `id`           | string | 文件 ID，格式 `file_<24位字母数字>`（如 `file_maznwes8t9rsysg5r5enkvpr`）                                                 |
| `type`         | string | 固定为 `file`                                                                                                   |
| `filename`     | string | 文件名（自上传时表单部分解析得到）                                                                                            |
| `mime_type`    | string | 服务端检测的 MIME 类型                                                                                               |
| `size_bytes`   | int    | 文件大小，单位字节                                                                                                    |
| `downloadable` | bool   | 是否支持下载。当前接口直传与会话沙箱拷贝均为 `false`                                                                               |
| `status`       | string | 安全审核状态：`available`（通过，可挂载） / `checking`（审核中） / `rejected`（内容未通过） / `type_rejected`（类型不支持）。新上传文件默认 `checking` |
| `created_at`   | string | 上传时间，ISO 8601                                                                                                |
| `requestId`    | string | 本次请求的唯一标识。Python SDK 中对应属性为 `request_id`                                                                     |

## 作用域 <span id="h-fu-scope" />

普通上传返回的文件无 `scope` 字段（默认工作空间共享）；当文件被挂载到会话沙箱时，服务端会做内部拷贝并生成新的 `file_id`，该副本的元数据中带 `scope: {"type": "session", "id": "sesn_..."}`，仅对应会话可见。
