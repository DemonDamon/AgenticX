---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-api-errors
fetched: 2026-10-23
title: 错误码
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 错误码

> Managed Agents API 的错误响应结构与处理建议。

<meta property="og:title" content="错误码" />

调用出错时，服务返回如下结构的错误响应，`request_id` 与响应头 `x-request-id` 一致：

```json
{
  "type": "error",
  "error": {
    "code": "AGENT_001",
    "message": "智能体不存在"
  },
  "request_id": "35feaacc-7914-948f-a38e-010bf8095bc1"
}
```

## 常见错误码 <span id="h-ma-api-errors-codes" />

| code                       | HTTP 状态码 | 说明                                                           |
| -------------------------- | -------- | ------------------------------------------------------------ |
| AGENT\_001                 | 404      | 智能体不存在                                                       |
| 400                        | 400      | 参数校验失败，`message` 给出具体原因（如 `limit must be between 1 and 100`） |
| InvalidApiKey              | 401      | 未携带或 API Key 无效（网关层）                                         |
| Endpoint.AccessDenied      | 403      | 工作空间不存在或无权限（网关层）                                             |
| BadRequest.IllegalEndpoint | 400      | 工作空间路由无效（网关层）                                                |

<Note>
  鉴权与工作空间路由类错误由网关直接返回，响应结构为扁平的 `{"request_id", "code", "message"}`；业务错误由服务返回，`error.code` 为业务错误码。
</Note>

## 常见 HTTP 状态码 <span id="h-ma-api-errors-http" />

| HTTP 状态码 | 说明               |
| -------- | ---------------- |
| 400      | 参数缺失、格式错误、超出取值范围 |
| 401      | API Key 无效       |
| 403      | 工作空间无权限          |
| 404      | 资源不存在            |
| 409      | 当前资源状态不允许执行该操作   |
| 429      | 请求过于频繁           |
| 500      | 服务内部异常           |

<Tip>
  排查问题时，可使用 `request_id` 定位具体请求；继续调用请对照[概览](managed-agents-api-overview.md)的接口清单。
</Tip>
