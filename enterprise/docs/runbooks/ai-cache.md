# AI Gateway 缓存运维

## 开关

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_CACHE_L1` | `on` | L1 精确缓存 |
| `GATEWAY_CACHE_L2` | `off` | L2 语义缓存 |
| `GATEWAY_CACHE_L1_TTL` | `5m` | L1 TTL |
| `GATEWAY_CACHE_SEMANTIC_THRESHOLD` | `0.92` | L2 相似度阈值 |
| `GATEWAY_CACHE_REPLAY_MODE` | `burst` | 流式回放模式 |
| `REDIS_URL` | 空 | 配置后 L1 使用 Redis |

Admin Console `/admin/cache` 写入 `enterprise/.runtime/admin/cache-config.json`，保存后调用网关 `/internal/cache/reload`。

## 驱逐

```bash
curl -X POST "$GATEWAY/internal/cache/evict" \
  -H "Authorization: Bearer $GATEWAY_INTERNAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"prefix":"<key-hash-prefix>"}'
```

## 回退

设置 `GATEWAY_CACHE_L1=off` 与 `GATEWAY_CACHE_L2=off` 后重启网关，行为与未启用缓存一致。
