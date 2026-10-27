---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/file-delete
fetched: 2026-10-23
title: 删除 File
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 File

> 硬删除文件元数据与原始内容，不可恢复。已挂载到会话沙箱的内部拷贝不受影响；新会话无法再挂载该 file_id。

<meta property="og:title" content="删除 File" />

## 前提 <span id="h-fd-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-fd-endpoint" />

<strong>DELETE</strong> `/files/{file_id}`

## 请求示例 <span id="h-fd-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/files/file_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.files.delete("file_xxx")
  ```

  ```python Python SDK
  import os
  from dashscope import Files

  # 删除文件
  result = Files.delete(file_id='file-xxx', api_key=os.getenv('DASHSCOPE_API_KEY'))
  print(result)
  ```

  ```java
  client.files().delete("file_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-fd-resp" />

```json
{
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-fd-dto" />

| 字段           | 类型     | 说明        |
| ------------ | ------ | --------- |
| `request_id` | string | 本次请求的唯一标识 |
