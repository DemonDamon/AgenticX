# AI Gateway API

> 源码：`apps/gateway/internal/server/server.go`（路由注册：`Router()` 方法）

基址：`http://localhost:8088`（`GATEWAY_HTTP_ADDR`）

OpenAI 兼容 + 企业管控扩展。

---

## 公开路由

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/healthz` | 无 | 健康检查 |
| POST | `/v1/chat/completions` | JWT Bearer | 聊天（支持 `stream: true` SSE） |
| POST | `/v1/embeddings` | JWT Bearer | 向量嵌入 |

### Chat Completions

**Headers**

```
Authorization: Bearer <portal_jwt>
Content-Type: application/json
```

可选路由 headers（见 `routing.Decider`）：

- Provider 显式指定 header（配置项 `provider_header`）
- `local_route_header` — 强制 local / private-cloud / third-party

**Body**：标准 OpenAI chat completions JSON。

**响应**

- 非流式：OpenAI JSON + usage
- 流式：`text/event-stream`，SSE data lines
- 策略 block：业务错误 JSON（非上游模型拒答文案），含命中规则信息

**流式加固环境变量**

- `GATEWAY_STREAM_IDLE_TIMEOUT`
- `GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB`

---

## Internal 路由

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/internal/channel-stats` | `GATEWAY_INTERNAL_TOKEN` | Channel 运行统计 |

---

## 上游 Key 解析

`OpenAICompatibleProvider` 顺序：

1. `<PROVIDER>_API_KEY`（provider 名大写、`-` → `_`）
2. `LLM_API_KEY` 通用兜底
3. 未配置 → mock 回退（链路仍走策略/审计/计量）

Admin GUI 配置的 Key 存 PG cipher，gateway runtimeconfig ~5s 轮询，优先级高于 env。

---

## 配置来源

| 配置 | 环境变量（远程） | 环境变量（本地） |
|---|---|---|
| Providers | `GATEWAY_REMOTE_PROVIDERS_URL` | `GATEWAY_ADMIN_PROVIDERS_FILE` |
| 配额 | `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | `GATEWAY_QUOTA_CONFIG_FILE` |
| 策略快照 | `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | `GATEWAY_POLICY_SNAPSHOT_FILE` |
| Channel | `GATEWAY_REMOTE_CHANNELS_URL` | PG `gateway_channels` |
| 策略覆盖 | — | `GATEWAY_POLICY_OVERRIDE_FILE` |

远程拉取需 `GATEWAY_INTERNAL_TOKEN` 与 admin 一致。

---

## 审计与计量输出

| 输出 | 路径/表 |
|---|---|
| 审计 JSONL | `apps/gateway/.runtime/audit/audit-*.jsonl` |
| 审计 PG | `gateway_audit_events` |
| 待回灌 | `.runtime/audit/.pg-pending` |
| 计量 PG | `usage_records` |
| 计量 JSONL | `GATEWAY_USAGE_LOG`（无 PG 时） |

---

## 构建与运行

```bash
cd enterprise/apps/gateway
go build -o bin/gateway ./cmd/gateway
go run ./cmd/gateway
```

Docker：

```bash
cd enterprise
docker build -f apps/gateway/Dockerfile -t agenticx-gateway:latest .
```

详见 [../gateway/overview.md](../gateway/overview.md) 与 [../../apps/gateway/README.md](../../apps/gateway/README.md)。

---

## 与 Machi Desktop 区别

Enterprise Gateway 为独立 Go 进程。Machi Desktop 使用内嵌 Python `agx serve` + LiteLLM，**不是同一实现**。
