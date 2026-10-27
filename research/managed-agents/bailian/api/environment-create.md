---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-create
fetched: 2026-10-23
title: 创建 Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Environment

> 创建一个运行环境。请求体定义沙箱类型、预装依赖与网络策略；响应返回完整的 Environment 对象。

<meta property="og:title" content="创建 Environment" />

## 前提 <span id="h-ec-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-ec-endpoint" />

<strong>POST</strong> `/environments`

## 请求体 <span id="h-ec-req" />

| 字段                  | 必填 | 类型     | 说明                                                                   |
| ------------------- | -- | ------ | -------------------------------------------------------------------- |
| `name`              | 是  | string | 工作空间内唯一标识                                                            |
| `description`       | 否  | string | 环境用途说明                                                               |
| `scope`             | 否  | string | 作用域。`organization`：工作空间全部成员可见与复用。默认 `organization`                   |
| `config.type`       | 否  | string | `cloud` 云端容器。创建后不可修改。未传入 `config` 时服务端默认补全为 `cloud`                  |
| `config.packages`   | 否  | object | 预装依赖，按包管理器分组。键为 `apt` / `pip` / `npm`，值为包名数组。安装可能需要预热时间，完成前环境不可被会话绑定 |
| `config.networking` | 否  | object | 网络策略对象，结构 `{"type": "unrestricted"}`，目前仅支持放行全部出站访问                   |
| `metadata`          | 否  | object | 业务自定义键值，不影响运行行为                                                      |

## 请求示例 <span id="h-ec-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/environments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-sandbox",
      "description": "数据分析沙箱",
      "scope": "organization",
      "metadata": {"team": "infra"},
      "config": {
        "type": "cloud",
        "packages": {
          "apt": ["ffmpeg"],
          "pip": ["pandas", "numpy", "matplotlib"]
        },
        "networking": {"type": "unrestricted"}
      }
    }'
  ```

  ```python
  env = client.environments.create(
      name="data-sandbox",
      config={
          "type": "cloud",
          "networking": {"type": "unrestricted"},
          "packages": {
              "apt": ["ffmpeg"],
              "pip": ["pandas", "numpy", "matplotlib"],
          },
      },
      description="数据分析沙箱",
      scope="organization",
      metadata={"team": "infra"},
  )
  ```

  ```java
  Environment env = client.environments().create(EnvironmentCreateParam.builder()
      .name("data-sandbox")
      .description("数据分析沙箱")
      .build());
  ```
</CodeGroup>

## 响应示例 <span id="h-ec-resp" />

```json
{
  "id": "env_xxx",
  "type": "environment",
  "name": "data-sandbox",
  "description": "数据分析沙箱",
  "scope": "organization",
  "config": {
    "type": "cloud",
    "packages": {"apt": ["ffmpeg"], "pip": ["pandas", "numpy", "matplotlib"]},
    "networking": {"type": "unrestricted"}
  },
  "metadata": {"team": "infra"},
  "archived_at": null,
  "created_at": "2026-06-16T12:45:34+08:00",
  "updated_at": "2026-06-16T12:45:34+08:00",
  "requestId": "xxx"
}
```

响应为 Environment 对象。字段如下：

### 响应字段 <span id="h-ec-dto" />

| 字段                                                       | 类型              | 说明                                                             |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| `id`                                                     | string          | 环境 ID，格式 `env_<base64 编码字符串>`，示例值 `env_N2M2OTc4NTY4ZjRkNDEwZT` |
| `type`                                                   | string          | 固定为 `environment`                                              |
| `name` / `description` / `scope` / `config` / `metadata` | string / object | 同请求体；`config` 为完整运行时配置（沙箱类型、预装依赖、网络策略）                         |
| `archived_at`                                            | string / null   | 归档时间，未归档时为 `null`                                              |
| `created_at` / `updated_at`                              | string          | 创建 / 最近更新时间，ISO 8601                                           |
| `requestId`                                              | string          | 本次请求的唯一标识                                                      |
