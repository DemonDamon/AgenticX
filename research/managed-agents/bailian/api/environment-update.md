---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-update
fetched: 2026-10-23
title: 更新 Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Environment

> 采用部分更新语义：传入的字段会被更新，未传字段保留原值。运行中会话使用绑定时的快照，不受影响；新会话使用更新后的环境。config.type 不可变，传入异于原值将报错；config.packages 与 metadata 传入即整体替换原值。

<meta property="og:title" content="更新 Environment" />

## 前提 <span id="h-eu-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-eu-endpoint" />

<strong>POST</strong> `/environments/{environment_id}`

## 语义 <span id="h-eu-semantic" />

采用<strong>部分更新</strong>语义：请求体中传入的字段会被更新，未传字段保留原值。已绑定该环境的运行中会话使用绑定时的快照，不受更新影响；新会话使用更新后的环境。

- `config.type` 不可变，传入异于原值将报错。
- `config.packages` 传入即整体替换原值（含子键 `apt`、`pip` 等），未列出的包将被移除。
- `metadata` 传入即整体替换原值，不做键级合并。

## 请求体 <span id="h-eu-req" />

字段同[创建 Environment](environment-create.md)的<strong>请求体</strong>一节，仅传入需更新的字段。

## 请求示例 <span id="h-eu-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/environments/env_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-sandbox",
      "description": "数据分析沙箱（更新）",
      "scope": "organization",
      "metadata": {"team": "infra"},
      "config": {
        "type": "cloud",
        "packages": {"apt": ["ffmpeg"], "pip": ["pandas", "numpy", "scikit-learn"]},
        "networking": {"type": "unrestricted"}
      }
    }'
  ```

  ```python
  env = client.environments.update(
      "env_xxx",
      name="data-sandbox",
      description="数据分析沙箱（更新）",
      config={
          "type": "cloud",
          "networking": {"type": "unrestricted"},
          "packages": {"apt": ["ffmpeg"], "pip": ["pandas", "numpy", "scikit-learn"]},
      },
      metadata={"team": "infra"},
  )
  ```

  ```java
  Environment u = client.environments().update("env_xxx",
      EnvironmentUpdateParam.builder()
          .name("data-sandbox")
          .description("数据分析沙箱（更新）")
          .build());
  ```
</CodeGroup>

## 响应示例 <span id="h-eu-resp" />

```json
{
  "id": "env_xxx",
  "type": "environment",
  "name": "data-sandbox",
  "description": "数据分析沙箱（更新）",
  "config": {
    "type": "cloud",
    "packages": {"apt": ["ffmpeg"], "pip": ["pandas", "numpy", "scikit-learn"]},
    "networking": {"type": "unrestricted"}
  },
  "metadata": {"team": "infra"},
  "scope": "organization",
  "archived_at": null,
  "created_at": "2026-06-16T12:45:34+08:00",
  "updated_at": "2026-06-16T12:52:31+08:00",
  "request_id": "xxx"
}
```

响应为更新后的 Environment 对象。字段如下：

### 响应字段 <span id="h-eu-dto" />

| 字段                                                       | 类型              | 说明                   |
| -------------------------------------------------------- | --------------- | -------------------- |
| `id`                                                     | string          | 环境 ID                |
| `type`                                                   | string          | 固定为 `environment`    |
| `name` / `description` / `scope` / `config` / `metadata` | string / object | 更新后的环境配置；未传入字段保留原值   |
| `archived_at`                                            | string / null   | 归档时间，未归档时为 `null`    |
| `created_at` / `updated_at`                              | string          | 创建 / 最近更新时间，ISO 8601 |
| `request_id`                                             | string          | 本次请求的唯一标识            |
