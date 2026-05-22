# Enterprise Gateway：Key Pool、多维配额与 API Token (PAT)

面向客户技术对接的简要说明（2026-05-22）。

## 能力概览

| 能力 | 说明 |
|------|------|
| **Key 级 failover** | 同一 Channel 可配置多把上游 Key（`metadata.keyRefs`）；401/429/5xx 自动切下一把 Key |
| **多维配额** | 租户 / 部门 / 用户 / PAT 四 scope；支持 monthly tokens、TPM、RPM、并发 |
| **API Token (PAT)** | `Bearer agx-pat-...` 直连网关，供业务系统 / IDE / MCP 客户端使用 |

## Key Pool 配置

在 admin-console **Channel 管理**编辑页配置 **Key Refs**（环境变量名，逗号分隔）：

```json
{
  "keyRefs": ["DEEPSEEK_API_KEY_1", "DEEPSEEK_API_KEY_2"]
}
```

网关进程须能读取对应环境变量。单 Key 仍可用 Channel 的 API Key 字段。

## PAT 使用

1. 在 web-portal「个人中心 → API Tokens」或 admin-console「API Tokens」创建 Token
2. 明文仅在创建时展示一次，格式：`agx-pat-<base62>`
3. 调用示例：

```bash
curl -H "Authorization: Bearer agx-pat-..." \
  -H "Content-Type: application/json" \
  http://gateway:8088/v1/chat/completions \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

## 配额

admin-console **计量 → 配额** 可按租户 / 部门 / 用户 / PAT 设置 monthly / TPM / RPM / 并发限制。命中返回 `policy:quota:*_exceeded`。

## 私有化

- Redis 可选：未配置时限流降级为单实例内存语义
- 上游 Key 不落库明文，PAT 仅存 SHA-256 hash

Made-with: Damon Li
