# API Tokens（PAT）

企业用户或管理员可创建 **Personal Access Token**，用于业务系统 / IDE / MCP 客户端直连 Enterprise Gateway。

## 格式

- 前缀：`agx-pat-`
- 示例：`agx-pat-8e79F28d9s78K908z76B89v87n89m78P`
- 库内仅存 SHA-256 hash；明文仅在创建时返回一次

## 调用示例

```bash
export PAT="agx-pat-..."
curl -s -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8088/v1/chat/completions \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

## 管理入口

| 端 | 路径 |
|----|------|
| admin-console | `/admin/api-tokens` |
| web-portal | 设置 → API Tokens（`/api/me/api-tokens`） |

## 吊销

吊销后网关 LRU 缓存最长 60s 内仍可能接受旧 Token；生产环境建议在吊销后等待 TTL 或重启网关实例。

Made-with: Damon Li
