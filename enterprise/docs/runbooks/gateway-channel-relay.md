# Gateway Channel + Relay 运维手册

## 启用条件

1. 在 admin-console **Channel 管理** 创建至少一条 `active` Channel。
2. Gateway 进程设置：
   - `GATEWAY_CHANNEL_REGISTRY=on`
   - `GATEWAY_REMOTE_CHANNELS_URL=https://<admin>/api/internal/channels`（或本地 `GATEWAY_ADMIN_CHANNELS_FILE`）
   - `GATEWAY_INTERNAL_TOKEN` 与 admin-console 一致

## 回退

关闭 `GATEWAY_CHANNEL_REGISTRY`（或设为 off）后，Gateway 回到原有 `Decider` + 单 Provider 路径，行为与升级前一致。

## 流式加固

| 变量 | 默认 | 说明 |
|------|------|------|
| `GATEWAY_STREAM_IDLE_TIMEOUT` | 60 | 上游 SSE 空闲秒数，超时返回 `stream:idle_timeout` |
| `GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB` | 16 | 单流累计 buffer 上限，超出返回 `stream:buffer_exceeded` |

## 审计字段

Channel 模式下审计 JSONL / PG 事件追加（nullable）：

- `channel_id`
- `attempt_index`
- `retry_reason`
- `estimated_tokens` / `actual_tokens` / `settle_delta`
- `attempts[]`（每次重试的 channel 与原因）

## 健康面板

admin-console **Channel 管理** 页通过 `GET /api/admin/channels/health` 聚合 Gateway `GET /internal/channel-stats`（需 `GATEWAY_INTERNAL_BASE_URL`）。

Made-with: Damon Li
