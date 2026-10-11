---
module_id: ops
module_name: Ops
roots:
  - agenticx/ops
summary_schema: code-module-summaries/v1
---

# AgenticX Ops 模块总结

> 结论生成时间：2026-09-18（首次创建，覆盖 `30e57496990b0e2acb18978091d9e623210eaba3`）

## 模块概述

Ops 是只读运维/排障查询面：把本机会话落盘、可选 SigNoz、ChangePlane 部署快照与 UModel 对象统一成 `TelemetryQuery` 契约，再以 `OPS_TOOLS` 注入 Studio 工具表。默认开启，可用 `AGENTICX_OPS_TOOLS` 或 `ops.tools_enabled` 关闭。本模块不写聊天正文、不重启服务、不发明 spans/logs。

Explicit non-responsibilities：不实现 Runtime 执行循环、OTel SDK 本体（只做 Studio 启动引导）、Enterprise Gateway 配额/策略；ChangePlane 的 restart/rollback/redeploy 在适配器层返回 `ACTION_DISABLED`。

## 目录结构

```
agenticx/ops/
├── __init__.py              # 再导出 QueryScope / TelemetryQuery / classify_trace_id
├── query.py                 # 冻结查询类型 + TelemetryQuery Protocol
├── factory.py               # get_telemetry_query()：first_party | signoz | auto
├── first_party.py           # 读 ~/.agenticx/sessions + 可选 audit JSONL
├── signoz.py                # 远端 HTTP traces/logs
├── change_log.py            # 本机变更事件读取
├── tools.py                 # OPS_TOOLS schema + dispatch + merge_ops_tools_into
├── slo.py                   # 通道 TTFT/TPS/cooldown/plugin_error 只读查询
├── parity.py                # 工具/委派/确认/用量四侧对账
├── otel_bootstrap.py        # maybe_enable_studio_otel()：失败永不抛给调用方
├── changeplane/             # 部署快照适配（Openship / Null / webhook / sync）
└── umodel/                  # UModel v0：schema / store / ingest
```

## 核心组件

### TelemetryQuery（query.py + factory.py）

- `QueryScope`：`session_id` / `tenant_id` / `deployment_id` / `trace_id` / 时间窗 / `limit`（`clamp_limit`）。
- `TelemetryQuery`：`get_trace` / `get_logs` / `get_recent_changes`。
- `classify_trace_id()`：W3C 32 hex → `otel_w3c`；26 位 Crockford → `gateway_ulid`。
- `get_telemetry_query()`：`AGENTICX_TELEMETRY_BACKEND` 默认 `auto`；有 `SIGNOZ_API_URL` 时用 `CompositeTelemetryQuery`（远端空结果回落 FirstParty）。`get_recent_changes` 始终走 FirstParty。

### FirstPartyProvider（first_party.py）

从 `AGENTICX_SESSIONS_ROOT`（默认 `~/.agenticx/sessions`）的 `messages.json` / `tool_call_observations.json` 合成 spans 与 logs；可选 `AGENTICX_AUDIT_JSONL`。不返回聊天正文。

### OPS_TOOLS（tools.py）

| 工具名 | 作用 |
|--------|------|
| `get_trace` | 按 session/trace 取 spans（含 tool 行） |
| `get_logs` | 失败排查日志 / observation 摘要 |
| `get_recent_changes` | 本机变更事件 |
| `get_session_review` | 与 Desktop 健康卡同口径的 0–100 五维分（不落盘） |
| `get_umodel` | 列 UModel 对象；空则 first_party ingest |
| `sync_changeplane` | 拉取部署并 upsert 本地 umodel（不 restart） |
| `get_trace_parity` | 工具/委派/确认/用量四侧对账 |
| `get_channel_slo` | TTFT / TPS / cooldown / plugin_error |

`merge_ops_tools_into()` 按名去重后并入 STUDIO 工具表；`ops_tools_enabled()`：环境变量优先于 `config.yaml` `ops.tools_enabled`，缺省为开。

### ChangePlane（changeplane/）

- 类型：`DeploymentSnapshot` / `ChangePlaneResult`；`ACTION_DISABLED`。
- `get_changeplane()`：有 base URL 用 `OpenshipProvider`，否则 `NullChangePlaneProvider`。
- `sync_deployments` / `upsert_snapshot` / `apply_webhook_payload`。
- Studio 入站：`POST /api/ops/changeplane/webhook`（`AGENTICX_CHANGEPLANE_WEBHOOK_SECRET`，HMAC 比对）。

### UModel（umodel/）

对象 kind：`service` / `session` / `tool_call` / `model_channel` / `alert` / `deployment`。`FORBIDDEN_ATTR_KEYS` 禁止 `content`/`messages`/`prompt` 等聊天字段。`prepare_object()` 裁剪 summary/attr 至 512 字节后校验。

### SLO / Parity / OTel bootstrap

- `slo.py`：读 `AGENTICX_GATEWAY_METRICS_*` / `CHANNEL_STATS_*`（文件或 URL），缺证据标 `missing`，不把 missing 当根因。
- `parity.py`：只声明各侧 present/missing。
- `otel_bootstrap.maybe_enable_studio_otel()`：按 `OTelConfig.from_env()` 启用并注册 hooks，异常吞掉返回 False。

## 配置

| 键 / 环境变量 | 默认 | 说明 |
|---------------|------|------|
| `AGENTICX_OPS_TOOLS` / `ops.tools_enabled` | 开 | 是否注入 OPS_TOOLS |
| `AGENTICX_TELEMETRY_BACKEND` | `auto` | first_party / signoz / auto |
| `AGENTICX_SESSIONS_ROOT` | `~/.agenticx/sessions` | FirstParty 根 |
| `SIGNOZ_API_URL` / `SIGNOZ_API_KEY` | 空 | 远端 |
| `AGENTICX_CHANGEPLANE_WEBHOOK_SECRET` | 空 | 空则 webhook 403 `webhook_disabled` |

## 依赖

- Upstream：Studio `/chat` 工具表、`cli/config_manager.OpsSettings`、`studio/changeplane_routes`。
- Downstream：`observability.otel`（可选）、`learning.loop_review`（session review）、本机会话 JSON。
