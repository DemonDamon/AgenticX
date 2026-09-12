# API Tokens（PAT）

企业用户或管理员可创建 **Personal Access Token**，用于业务系统 / IDE / MCP 客户端直连 Enterprise Gateway。源码：`enterprise/apps/gateway/internal/auth/pat.go`。

## 格式与存储

- 前缀：`agx-pat-`
- 示例：`agx-pat-8e79F28d9s78K908z76B89v87n89m78P`
- 库表 `api_tokens` 仅存 SHA-256 `token_hash`；明文只在创建响应里出现一次
- 行字段：`tenant_id`、`user_id`、`dept_id`、`status`、`scopes`、`expire_at`
- `last_used_at` 由网关约每 60s 批量 flush

网关识别 `Authorization: Bearer` 以 `agx-pat-` 开头的值，走 `PATVerifier`，不走 portal cookie。

## 调用示例

```bash
export PAT="agx-pat-..."
curl -s -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8088/v1/chat/completions \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

MCP 托管开启时，同一 PAT 也可打 `GET /mcp/registry`（需具备对应 `mcp:` scopes）。见 [mcp-hosting-overview.md](./mcp-hosting-overview.md)。

## 管理入口

| 端 | 路径 |
|----|------|
| admin-console | `/admin/api-tokens` |
| web-portal | 设置 → API Tokens（`/api/me/api-tokens`） |

## 吊销与缓存

- `status` 非 active、过期、或吊销存储命中 → `auth:pat_revoked` / 无效
- 验证成功的身份会进进程 LRU，TTL 约 60s（可用环境变量覆盖，见 `patCacheTTLFromEnv`）
- 生产环境吊销后应等待 TTL 或重启网关实例，不要假设瞬时全集群失效

配额若为该 PAT 配了 `apiTokens` 规则，选择顺序优先于 user / dept。见 [keypool-pat-overview.md](./keypool-pat-overview.md)。

Made-with: Damon Li
