# 网关 Chat 压测方法与性能基线

> **Plan-Id**: `2026-06-05-gateway-load-testing-baseline`  
> 本文档说明如何复现压测、如何解读基线文件，以及与客户 SLA 口径的差异。

---

## 1. 目标

- 度量 **AI 网关自身** 在 `/v1/chat/completions` 路径上的吞吐与延迟（非流式 / 流式 / 策略+配额）。
- 使用 **可控 mock 上游**（可调固定延迟、标准 usage），避免真实模型延迟污染结果。
- 产出可归档、可对比的 JSON 基线（含 commit / 机器规格 / 参数）。

**重要限制**：本基线为 **单机本地实测**，不等于生产环境「万级 TPS / P95&lt;50ms / 99.999%」承诺。投标或对外材料须区分 **「实测基线」** 与 **「生产估算 / 部署建议」**。

---

## 2. 组件

| 组件 | 路径 |
|---|---|
| Mock 上游 | `enterprise/scripts/perf/mock-upstream/` |
| JWT 签发（k6 用） | `enterprise/scripts/perf/mint-perf-jwt/` |
| k6 脚本 | `gateway-chat-nonstream.js` / `gateway-chat-stream.js` / `gateway-policy-quota.js` |
| 一键 harness | `enterprise/scripts/perf/run-gateway-baseline.sh` |
| 基线归档 | `enterprise/docs/perf-baselines/gateway-chat-*.json` |

---

## 3. 前置条件

1. `go`、`k6`、`python3` 已安装（macOS: `brew install k6`）。
2. 已执行 `cd enterprise && bash scripts/bootstrap.sh`，存在 `.local-secrets/auth_*.pem`。
3. 端口空闲：`19099`（mock）、`18088`（perf 专用 gateway，不与日常 dev 8088 冲突）。

---

## 4. 运行方式

### 4.1 一键基线（推荐）

```bash
cd enterprise
bash scripts/perf/run-gateway-baseline.sh
```

常用参数：

```bash
PERF_K6_VUS=50 PERF_K6_DURATION=60s MOCK_UPSTREAM_DELAY_MS=10 \
  bash scripts/perf/run-gateway-baseline.sh
```

产物：`docs/perf-baselines/gateway-chat-<YYYYMMDD>-<commit>.json`

### 4.2 单脚本（已有 gateway + mock 时）

```bash
export GATEWAY_PERF_BASE=http://127.0.0.1:18088
export GATEWAY_PERF_BEARER="$(cd enterprise/scripts/perf/mint-perf-jwt && AUTH_JWT_PRIVATE_KEY_FILE=../../.local-secrets/auth_private.pem go run .)"
k6 run enterprise/scripts/perf/gateway-chat-nonstream.js
```

---

## 5. Mock 上游行为

- `POST /v1/chat/completions`：返回固定 usage（prompt 估算 + 12 completion tokens）。
- `stream: true`：SSE 分片 + `[DONE]`。
- 延迟：`MOCK_UPSTREAM_DELAY_MS` 或请求头 `X-Mock-Delay-Ms`。
- 目的：压测时把变量锁定，观察网关鉴权 / 策略 / 配额 / 计量 / 转发链开销。

---

## 6. 最新实测基线（示例）

来源文件：[`gateway-chat-20260607-98b175cd.json`](./gateway-chat-20260607-98b175cd.json)

| 环境 | 值 |
|---|---|
| Commit | `98b175cd` |
| 机器 | Apple M3 / Darwin 24.6.0 arm64 |
| Mock 延迟 | 0 ms |
| k6 | 5 VU × 5s（smoke 档位，非满载） |

| 场景 | req/s | P95 (ms) | 错误率 | 备注 |
|---|---:|---:|---:|---|
| 非流式 chat | ~14.8 | ~2.5 | 0% | 225 req |
| 流式 chat | ~14.8 | ~2.2 | 0% | 225 req |
| 策略 + 配额 | ~16.1 | ~3.6 | ~8%* | 含预期 403 策略拦截 |

\* `policy-quota` 场景故意发送 `__PERF_POLICY_BLOCK__` 触发 **403**，k6 全局 `http_req_failed` 会统计为失败；quota 子场景本身 0 失败。

---

## 7. 生产估算与部署建议（非 SLA）

基于 mock 上游（零模型延迟）的单机结果，真实生产需叠加：

1. **上游模型 RTT**：占端到端 P95 的主体；网关自身毫秒级开销在总延迟中占比随模型变慢而下降。
2. **水平扩展**：无状态 gateway 可多副本 + LB；配额 / 审计 / 计量需共享 PG / Redis。
3. **策略与 WASM 插件**：规则数量与插件数量近似线性增加 CPU；高 QPS 场景建议策略快照热加载 + 规则分级。
4. **缓存**：L1/L2 命中可显著降低上游调用；perf harness 默认关闭缓存以测最坏路径。
5. **观测**：Prometheus `/metrics` + 审计双写；压测前后对照 `gateway_audit_events` 与 `usage_records` 写入延迟。

**不得**将本文 smoke 档位（5 VU）数字直接写成「支持万级 TPS」；更高并发请在目标规格机器上提高 `PERF_K6_VUS` 重跑并归档新 JSON。

---

## 8. 夜间 CI（可选）

主仓不强制 CI 跑 k6。若需回归，可在独立 workflow 中：

1. 安装 k6；
2. 运行 `run-gateway-baseline.sh`（低 VU）；
3. 上传 `docs/perf-baselines/*.json` 为 artifact。

---

## 9. 回滚

删除 `enterprise/scripts/perf/` 新增目录与 `docs/perf-baselines/gateway-chat-*.json` 即可，不影响网关运行时代码。
