---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-archive
fetched: 2026-10-23
title: 归档 Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Environment

> 软归档：环境保留但默认不出现在列表中（除非 include_archived=true），仍可被 GET 查询。已绑定的会话继续可用。响应返回完整 Environment 对象，archived_at 字段被填入归档时间。

<meta property="og:title" content="归档 Environment" />

## 前提 <span id="h-ea-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-ea-endpoint" />

<strong>POST</strong> `/environments/{environment_id}/archive`

## 语义 <span id="h-ea-semantic" />

软归档：响应返回完整 environment 对象，`archived_at` 字段被填入归档时间。归档后默认不出现在列表中（除非 `include_archived=true`），仍可被 `GET` 查询。已绑定的会话继续可用。

## 请求示例 <span id="h-ea-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/environments/env_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.environments.archive("env_xxx")
  ```

  ```java
  client.environments().archive("env_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-ea-resp" />

```json
{
  "id": "env_xxx",
  "type": "environment",
  "name": "data-sandbox",
  "description": "数据分析沙箱",
  "config": {
    "type": "cloud",
    "packages": {"apt": ["ffmpeg"], "pip": ["pandas", "numpy", "matplotlib"]},
    "networking": {"type": "unrestricted"}
  },
  "metadata": {"team": "infra"},
  "scope": "organization",
  "archived_at": "2026-06-16T13:47:18+08:00",
  "created_at": "2026-06-16T12:45:34+08:00",
  "updated_at": "2026-06-16T13:47:18+08:00",
  "requestId": "xxx"
}
```

响应为 Environment 对象，`archived_at` 已填入归档时间。字段如下：

### 响应字段 <span id="h-ea-dto" />

| 字段                                                       | 类型              | 说明                              |
| -------------------------------------------------------- | --------------- | ------------------------------- |
| `id`                                                     | string          | 环境 ID                           |
| `type`                                                   | string          | 固定为 `environment`               |
| `name` / `description` / `scope` / `config` / `metadata` | string / object | 环境基础属性与完整运行时配置                  |
| `archived_at`                                            | string          | 归档时间，ISO 8601；归档接口返回的对象中该字段一定非空 |
| `created_at` / `updated_at`                              | string          | 创建 / 最近更新时间                     |
| `requestId`                                              | string          | 本次请求的唯一标识                       |
