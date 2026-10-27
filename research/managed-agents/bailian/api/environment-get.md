---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-get
fetched: 2026-10-23
title: 获取 Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Environment

> 根据环境 ID 返回完整配置，包括沙箱类型、预装依赖与网络策略。

<meta property="og:title" content="获取 Environment" />

## 前提 <span id="h-eg-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-eg-endpoint" />

<strong>GET</strong> `/environments/{environment_id}`

## 请求示例 <span id="h-eg-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/environments/env_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  env = client.environments.retrieve("env_xxx")
  ```

  ```java
  Environment env = client.environments().retrieve("env_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-eg-resp" />

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
  "archived_at": null,
  "created_at": "2026-06-16T12:45:34+08:00",
  "updated_at": "2026-06-16T12:45:34+08:00",
  "request_id": "xxx"
}
```

响应为 Environment 对象。字段如下：

### 响应字段 <span id="h-eg-dto" />

| 字段                                                       | 类型              | 说明                             |
| -------------------------------------------------------- | --------------- | ------------------------------ |
| `id`                                                     | string          | 环境 ID，格式 `env_<ULID>`    |
| `type`                                                   | string          | 固定为 `environment`              |
| `name` / `description` / `scope` / `config` / `metadata` | string / object | 环境基础属性与完整运行时配置（沙箱类型、预装依赖、网络策略） |
| `archived_at`                                            | string / null   | 归档时间，未归档时为 `null`              |
| `created_at` / `updated_at`                              | string          | 创建 / 最近更新时间，ISO 8601           |
| `request_id`                                             | string          | 本次请求的唯一标识                      |
