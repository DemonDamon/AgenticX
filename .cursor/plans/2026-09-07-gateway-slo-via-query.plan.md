# S6：通道 SLO 只读查询（TTFT / TPS / 冷却 / plugin 错误）

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-06-agenticops-platform-master.plan.md`
Depends-on: S2 `2026-09-06-telemetry-query-and-default-box` 已合入（`TelemetryQuery` 三方法冻结；`deploy/observability/gateway-scrape` 已存在）
Plan-Id: 2026-09-07-gateway-slo-via-query
Wave: 1（数据质量）
Adopt / Wrap / Build: **Build** 本仓只读查询层。指标**已经**在 Gateway Prometheus 里；本 plan 只解析与暴露，不造第二套指标。禁止改 `TelemetryQuery` Protocol。禁止做 Grafana 必选项。禁止编造数值。

> **For implementer:** 不看对话也能落地。不要 commit，除非用户明确要求。实施前把本文件移到 `.cursor/plans/` 根目录。

**Goal:** 调查 Agent 能按通道 / 模型查出 TTFT、TPS、冷却、plugin 错误；缺证据标 `missing` 或 `not_configured`，禁止把缺失说成根因。人继续看默认观测盒的服务视图，不另做 Grafana。

**Architecture:** 新模块 `agenticx/ops/slo.py` 只读两类证据，**不连** Collector、不查远程指标查询语言：(1) Prometheus 文本（`/metrics` 或 fixture 文件）里的 `agx_gateway_ttft_seconds_*` / `agx_gateway_tokens_per_second_*` / `agx_plugin_errors_total`；(2) Gateway `GET /internal/channel-stats`（或 fixture JSON）里的 `cooldown_until`。新工具 `get_channel_slo` 走独立 dispatch（与 `get_trace_parity` 同模式），**永远不**经 `CompositeTelemetryQuery` / SigNoz。CI 只用文件，禁止打真网关。

**Tech Stack:** 现有 pytest + 标准库（`urllib` / `re` / `json`）。不新增 `prometheus_client`。不改 Go 网关。不改 `server.py`。

---

## 质量门（Master §9）

| 问 | 答 |
|----|----|
| 对应哪道坎？ | Wave 1。准出是「Agent 能引用通道侧证据」，不是 RCA、不是看板绿 |
| 为什么不 Adopt 远程指标查询 / Grafana？ | CI 与本机默认盒经常没有远程查询 API。Master 写明人看页复用已有服务视图，**不另做 Grafana 必选项**。Agent 面对我们自己的工具，不能把远程查询语言泄漏进工具表 |
| 精确落点 | 见「包落点」与各 FR |
| 关联键如何传播？ | 本 plan **不**把 `session_id` 写进 Prometheus label（S1 高基数禁令）。入参可选 `channel` / `model` / `plugin`。Producer 仍是 Gateway `ObserveTTFT` / `ObserveTPS` / `pluginErrors` / `StatsStore.RecordFailure`。Consumer 是 `get_channel_slo` |
| 无证据不得给根因 | 未配置路径 → `not_configured`。文件/HTTP 空 → `scrape_empty` 或 HTTP reason。`status=missing` 不是故障结论 |
| 人怎么接管？ | 浏览器打开 Gateway `/metrics`；有内部令牌时打开 `/internal/channel-stats`；人或现场看默认观测盒 UI `:8080` 服务视图 |

---

## 根因与证据链（实施者勿依赖对话）

1. Master §8 S6：调查 Agent 按通道/模型查 TTFT、TPS、冷却、plugin 错误；人看页可复用默认观测盒服务视图，不另做 Grafana。依赖 S2。
2. `TelemetryQuery`（`agenticx/ops/query.py` L66–71）**只**有 `get_trace` / `get_logs` / `get_recent_changes`。S2 / S4 / S5 已冻结，**禁止**加 `get_metrics` / `get_slo`。对账工具 `get_trace_parity` 已示范：新能力用新模块 + 新 ops 工具，绕过 Composite。
3. Gateway 指标已在 `enterprise/apps/gateway/internal/observability/metrics.go`：
   - L56–65：`agx_gateway_ttft_seconds`（label `model,channel,inbound_protocol`）、`agx_gateway_tokens_per_second`（`model,channel`）
   - L86–90：`agx_plugin_errors_total`（label `plugin`）
   - L74–77：`agx_gateway_channel_health`（Help 写 `1=healthy,0=cooldown`）
   - 暴露：`server.go` L657–658 `r.Handle("/metrics", s.metrics.Handler())`
4. **冷却的权威不在 Prometheus。** `SetChannelHealth`（`metrics.go` L173）在全仓 **零调用点**（`rg SetChannelHealth` 只有定义）。真实冷却在 `channel.StatsStore`（`picker.go` L286–294 `CooldownUntil`），经 `channel_relay.go` L110–132 `channelStatsJSON()` 输出 `cooldown_until`，路由 `server.go` L660 `GET /internal/channel-stats`，鉴权 `channel_handlers.go` L243–253：`GATEWAY_INTERNAL_TOKEN` 为空则 **永远 401**；非空则 `Authorization: Bearer <token>`。
5. S2 已提供刮取 sidecar：`deploy/observability/gateway-scrape/otel-collector-config.yaml` 把宿主机 `:9090` 打到盒 `4317`。本 plan **不改** scrape 目标与 label。人看页 = 盒 UI，不是本 plan 新页面。
6. S5 已声明「禁止查 TTFT/TPS」。本 plan 才做。不要回头改 `parity.py`。
7. `metrics_cardinality_test.go` 禁止给这些指标加 `session_id` / `trace_id` / `deployment_id`。本 plan **一行都不改** `metrics.go`。

---

## 包落点（拍板，禁止两处各写一份）

| 用途 | 路径 |
|------|------|
| 解析 + 组行 | **新建** `agenticx/ops/slo.py` |
| 工具 | `agenticx/ops/tools.py` + `agenticx/cli/agent_tools.py` L9326 集合 |
| 设置文案 | `desktop/src/components/automation/RuntimeConfigSection.tsx` L50 |
| 盒说明（一段） | `deploy/observability/README.md` 文末补「调查工具」小节 |
| 冒烟 | `tests/test_smoke_gateway_slo.py` + `tests/test_smoke_ops_tools.py` 名称集合 |
| **不建 / 不改** | `query.py` Protocol、`signoz.py`、`factory.py`、`parity.py`、`metrics.go`、`picker.go`、`server.py`、Grafana JSON、远程指标查询 API、UModel 写入、体检公式 |

---

## In scope

- `parse_prom_text` / `parse_channel_stats` / `build_slo_rows` / 文件优先的只读 fetch
- 只读工具 `get_channel_slo`
- fixture 冒烟；回归已有 ops / telemetry / umodel / parity / otel hooks
- README 用中性措辞写清：Agent 读 `/metrics` + channel-stats；人看默认盒服务视图

## Out of scope

- 改 `TelemetryQuery` / SigNoz / Composite / `get_trace_parity`
- 给 `SetChannelHealth` 接线（gauge 空 = `missing`，不是本 plan 的 bug）
- 改 Prom label、加 `session_id`、算 p95/p99（只允许 `_sum/_count` 均值）
- Grafana / LGTM / Loki / Tempo 适配器
- 远程指标查询语言、ClickHouse 手搓表
- 写入 UModel `model_channel`、改体检、改 `agent_runtime.py`
- 改 `server.py` 顶部 import（`GroupChatRegistry` 一行都不能删）
- 启动真 Gateway、打真网、`create_studio_app()`
- 客户名、对标竞品 commit 文案

---

## 现状锚点

| 符号 | 路径 | 约行 / 锚点 |
|------|------|-------------|
| `TelemetryQuery` 三方法 | `agenticx/ops/query.py` | L66–71 |
| `ObserveTTFT` / `ObserveTPS` | `metrics.go` | L144–157 |
| `/metrics` | `server.go` | L657–658 |
| `/internal/channel-stats` | `server.go` L660；handler `channel_handlers.go` L172–185 | |
| `channelStatsJSON` | `channel_relay.go` | L110–132：`cooldown_until` 为零值则 JSON `null` |
| 内部鉴权 | `channel_handlers.go` | L243–253 |
| 刮取 sidecar | `deploy/observability/gateway-scrape/otel-collector-config.yaml` | `job_name: agx-gateway` |
| 基数测试 | `metrics_cardinality_test.go` | L17–25 |
| `OPS_TOOLS` / `dispatch_ops_tool` | `agenticx/ops/tools.py` | L29 起；`get_trace_parity` 分支 L378–379 |
| Studio 白名单 | `agenticx/cli/agent_tools.py` | L9326 |
| 设置文案 | `RuntimeConfigSection.tsx` | L50（现以 `get_trace_parity` 结尾） |
| HTTP GET 范本（失败不抛） | `agenticx/ops/signoz.py` | `_get_json` L84–100；**复制风格到 slo.py，不要改 signoz.py** |
| `_json_ready` | `agenticx/ops/tools.py` | 已有；dispatch 复用 |

---

## 冻结类型与常量（写进 `slo.py`）

```python
from dataclasses import dataclass, field

PRESENT = "present"
MISSING = "missing"

SLO_KINDS = ("ttft", "tps", "cooldown", "plugin_error")

METRIC_TTFT = "agx_gateway_ttft_seconds"
METRIC_TPS = "agx_gateway_tokens_per_second"
METRIC_PLUGIN_ERRORS = "agx_plugin_errors_total"

ENV_METRICS_FILE = "AGENTICX_GATEWAY_METRICS_FILE"
ENV_METRICS_URL = "AGENTICX_GATEWAY_METRICS_URL"
ENV_STATS_FILE = "AGENTICX_GATEWAY_CHANNEL_STATS_FILE"
ENV_STATS_URL = "AGENTICX_GATEWAY_CHANNEL_STATS_URL"
ENV_INTERNAL_TOKEN = "AGENTICX_GATEWAY_INTERNAL_TOKEN"


@dataclass
class SloRow:
    kind: str
    key: str
    name: str
    evidence: str = MISSING  # present | missing
    value: str = ""
    unit: str = ""
    status: str = "missing"  # ok | missing
    summary: str = ""
    channel: str = ""
    model: str = ""
    plugin: str = ""
    attrs: dict[str, str] = field(default_factory=dict)
```

`status` 规则（写死）：

1. `evidence==present` → `status=ok`。`value` 必须来自解析到的数字或时间戳字符串。
2. `evidence==missing` → `status=missing`，`value` 必须是 `""`。禁止填 `0` 冒充「测到了」。
3. 禁止第三种「编造 present」。
4. `summary` 只允许短词拼接、截断 128：`kind`、`ok|missing`、`channel=` / `model=` / `plugin=` 的 **id 本身**（不是 last_error 全文）。`last_error` 只进 `attrs`，截断 128。

---

## 解析规则（写死，不要「按需推断」）

### Prometheus 文本

只认这三族；**忽略** `agx_gateway_channel_health` 以及 cache / http / streams / upstream / plugin_invocations / plugin_latency。

直方图只读后缀 `_sum` 与 `_count`。不要读 `_bucket`，不要算分位数。

行规则：

- 跳过空行与 `#` 开头。
- 用正则（整行）：

```python
_PROM_LINE = re.compile(
    r"^([a-zA-Z_:][a-zA-Z0-9_:]*)"
    r"(?:\{([^}]*)\})?"
    r"\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$"
)
_PROM_LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"')
```

- label 值去掉 `\"` → `"`。非法行跳过。
- `ttft` 组键 = `(labels[channel], labels[model])`。`inbound_protocol` **不进组键**：同一 channel+model 多 protocol 时，**把 sum 相加、count 相加**。
- `tps` 组键 = `(labels[channel], labels[model])`。
- `plugin_error` 组键 = `labels[plugin]`。
- 缺 label 时该维用 `"unknown"`（与 Go `safeLabel` 空串回落一致）。
- `ttft`/`tps` 的展示值：`count>0` 时 `value = f"{sum/count:.6g}"`，`unit` 为 `s`（ttft）或 `tps`（tps）。`count==0` 或只有 sum 没有 count → 该组 **不生成行**（不要用 0 均值）。
- `plugin_error`：系列存在即 `present`，`value` 为计数的十进制字符串（可以为 `"0"`——这是刮到的 0，不是编造）。`unit="count"`。

### channel-stats JSON

接受两种形状（先试嵌套，再试扁平）：

```text
obj["data"]["stats"]   # 线上 handleChannelStats
obj["stats"]           # 允许 fixture 扁平
```

`stats` 必须是 `dict`。每个 key = `channel_id`。字段：

| JSON 字段 | 用法 |
|-----------|------|
| `cooldown_until` | 非空字符串 → `attrs["cooling"]="1"`，`value` = 该字符串；`null`/缺省/空串 → `attrs["cooling"]="0"`，`value=""`。两种都是 **present**（看到了该通道） |
| `last_error` | 仅 `attrs["last_error"]`，截断 128 |
| `failure_count` / `success_count` | 可选抄进 attrs（字符串化）。解析失败则不加该 key |

**不要**用 `datetime.now()` 判断冷却是否过期（测试会抖）。非空 `cooldown_until` 即 `cooling=1`。

坏 JSON / 非 dict → 返回空 stats，不抛。

---

## Fetch 规则（文件优先，禁止默认出网）

```python
def load_metrics_text() -> tuple[str, str]:
    """Returns (text, reason). reason="" when text usable."""
    # 1) ENV_METRICS_FILE 非空且是文件 → 读 utf-8；读失败 → ("", "scrape_file")
    # 2) 否则 ENV_METRICS_URL 非空 → GET timeout=3；
    #    非 200 → ("", f"scrape_http_{code}")；网络错 → ("", "scrape_http_0")
    # 3) 都没有 → ("", "not_configured")

def load_channel_stats_obj() -> tuple[dict, str]:
    # 同上，FILE 优先。
    # URL 请求加 Header Authorization: Bearer {ENV_INTERNAL_TOKEN}
    # token 空仍可发请求（线上会 401 → scrape_http_401）
    # 不要把 token 写入返回、summary、attrs、日志
```

`get_channel_slo` 组合：

```
metrics_configured = file or url 非空
stats_configured = file or url 非空
if not metrics_configured and not stats_configured:
    return reason=not_configured, items=[]

text, m_reason = load_metrics_text() if metrics_configured else ("", "")
obj, s_reason = load_channel_stats_obj() if stats_configured else ({}, "")
rows = build_slo_rows(parse_prom_text(text), parse_channel_stats(obj), filters...)
if rows:
    reason = ""
else:
    reason = m_reason or s_reason or "scrape_empty"
```

一边失败、另一边有行 → `reason=""`（有证据就给行）。不要因为 metrics HTTP 失败而丢掉已解析的 cooldown 行。

---

## `build_slo_rows` 顺序

1. 先所有 `ttft`，再 `tps`，再 `cooldown`，再 `plugin_error`。
2. 同 kind 按 `key` 字典序。
3. `key` 写死：
   - ttft / tps：`f"{channel}|{model}"`
   - cooldown：`channel`
   - plugin_error：`plugin`
4. `name`：ttft=`ttft`，tps=`tps`，cooldown=`cooldown`，plugin_error=`plugin_error`。
5. 过滤（去空白后）：`channel` / `model` / `plugin` 参数非空则该维必须相等。空 = 通配。过滤后可以为空列表（reason 仍按上一节）。
6. **禁止**因过滤未命中而补一行 `missing` 占位。没有系列就是没有行。

---

## 工具 `get_channel_slo`

插在 `OPS_TOOLS` 里 `get_trace_parity` **之后**。

```python
{
    "type": "function",
    "function": {
        "name": "get_channel_slo",
        "description": (
            "Read-only. Fetch channel/model TTFT, TPS, cooldown, "
            "and plugin error counters. Never invent a present value. "
            "Missing is not a root cause. Not the health score."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "channel": {"type": "string"},
                "model": {"type": "string"},
                "plugin": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
}
```

`OPS_TOOL_NAMES` 加上 `get_channel_slo`。

`dispatch_ops_tool` 在 `get_trace_parity` 分支旁加：

```python
    if name == "get_channel_slo":
        return _dispatch_channel_slo(arguments)
```

`_dispatch_channel_slo`：

```python
def _dispatch_channel_slo(arguments: dict[str, Any] | None) -> str:
    from agenticx.ops.slo import query_channel_slo

    args = arguments or {}
    try:
        limit = clamp_limit(int(args.get("limit", 50)))
    except (TypeError, ValueError):
        limit = 50
    result = query_channel_slo(
        channel=str(args.get("channel") or "").strip(),
        model=str(args.get("model") or "").strip(),
        plugin=str(args.get("plugin") or "").strip(),
    )
    return json.dumps(
        {
            "source": "slo",
            "reason": result.reason,
            "items": [_json_ready(item) for item in result.rows[:limit]],
        },
        ensure_ascii=False,
    )
```

`query_channel_slo` 放在 `slo.py`，返回一个小 dataclass `SloQueryResult(rows: list[SloRow], reason: str)`。

`agent_tools.py` L9326 集合加上 `"get_channel_slo"`。只改这一处集合，禁止整段替换 import。

`RuntimeConfigSection.tsx` L50 在名单末尾追加 ` / get_channel_slo`。

---

## README 只加这一小节（`deploy/observability/README.md` 文末）

标题：`## 通道 SLO（调查工具）`

正文必须包含（可意译，但事实不能错）：

- Agent 工具名 `get_channel_slo`。
- 读 Gateway `/metrics` 的 TTFT / TPS / plugin 错误；冷却读 `/internal/channel-stats`。
- 本机/CI：`AGENTICX_GATEWAY_METRICS_FILE` 与 `AGENTICX_GATEWAY_CHANNEL_STATS_FILE` 优先于 URL。
- 人看默认盒 UI 服务视图；**不要**再起一份 Grafana。
- `channel_health` gauge 若为空，以 channel-stats 为准，不要把它解释成「通道一定健康」。

禁止在 README 写客户名、内部仓库绝对路径以外的运维秘密。

---

## Fixture（实施者按此写 helper，不要改字段名）

在 `tests/test_smoke_gateway_slo.py`：

`PROM_FIXTURE`（注意 `inbound_protocol` 有两条，必须合并）：

```
# TYPE agx_gateway_ttft_seconds histogram
agx_gateway_ttft_seconds_sum{model="m1",channel="ch-a",inbound_protocol="openai-chat"} 1.2
agx_gateway_ttft_seconds_count{model="m1",channel="ch-a",inbound_protocol="openai-chat"} 2
agx_gateway_ttft_seconds_sum{model="m1",channel="ch-a",inbound_protocol="openai-legacy"} 0.3
agx_gateway_ttft_seconds_count{model="m1",channel="ch-a",inbound_protocol="openai-legacy"} 1
# TYPE agx_gateway_tokens_per_second histogram
agx_gateway_tokens_per_second_sum{model="m1",channel="ch-a"} 90
agx_gateway_tokens_per_second_count{model="m1",channel="ch-a"} 3
# TYPE agx_plugin_errors_total counter
agx_plugin_errors_total{plugin="moderation"} 2
agx_gateway_channel_health{channel="ch-a",status="healthy"} 1
```

`STATS_FIXTURE`：

```json
{
  "code": "00000",
  "message": "ok",
  "data": {
    "enabled": true,
    "stats": {
      "ch-a": {
        "success_count": 10,
        "failure_count": 2,
        "success_rate": 0.83,
        "p50_latency_ms": 120,
        "last_error": "upstream timeout",
        "cooldown_until": "2099-01-01T00:00:00Z"
      },
      "ch-b": {
        "success_count": 4,
        "failure_count": 0,
        "last_error": "",
        "cooldown_until": null
      }
    }
  }
}
```

Helper：`_write_slo_files(tmp_path) -> tuple[Path, Path]` 写出 `metrics.prom` 与 `stats.json`，测试里 `monkeypatch.setenv` 两个 FILE，**delenv 两个 URL**。

---

## FR / AC

### FR-1：Prom 解析

**AC-1：** `test_parse_prom_merges_ttft_protocols`  
`parse_prom_text(PROM_FIXTURE)`：`(ch-a, m1)` 的 ttft `count==3`、`sum==1.5`（1.2+0.3）。忽略 `channel_health` 行（解析结果里没有 kind 用 health）。

**AC-2：** `test_parse_prom_tps_and_plugin`  
同 fixture：tps count=3 sum=90；plugin `moderation` value 解析为 2。

**AC-3：** `test_parse_prom_skips_bad_lines`  
文本含 `# comment`、空行、`not_a_metric`、缺数值的行 → 不抛，只留下合法点。

### FR-2：channel-stats 解析

**AC-4：** `test_parse_channel_stats_cooling_flags`  
`ch-a.cooling=="1"` 且 until 为 `2099-01-01T00:00:00Z`；`ch-b.cooling=="0"`。`last_error` 对 ch-a 为 `upstream timeout`。

**AC-5：** `test_parse_channel_stats_bad_json`  
`parse_channel_stats("nope")` 与 `parse_channel_stats({"data": []})` → 空 dict。

### FR-3：组行与过滤

**AC-6：** `test_build_slo_rows_order_and_keys`  
完整 fixture：kinds 顺序为 ttft → tps → cooldown ×2 → plugin_error。ttft key=`ch-a|m1`，value 为 `0.5`（1.5/3）。ch-a cooldown `cooling=1`；ch-b `cooling=0` 仍 `evidence==present`。

**AC-7：** `test_build_slo_rows_filter_channel`  
`channel="ch-b"`：没有 ttft/tps/plugin 行；有且仅有 cooldown `ch-b`。`channel="ch-z"` → 空列表（不编造 missing 占位）。

**AC-8：** `test_build_slo_rows_does_not_use_health_gauge`  
即使 fixture 含 `agx_gateway_channel_health`，rows 里 **没有** 用该 gauge 生成的行。冷却只来自 stats。

### FR-4：工具 + 配置

**AC-9：** `test_query_not_configured`  
两个 FILE、两个 URL 都 `delenv` → `reason=="not_configured"`，`items==[]`。

**AC-10：** `test_dispatch_get_channel_slo_from_files`  
写入 fixture 文件后 dispatch：返回 `source=="slo"`，含 ttft key `ch-a|m1`，字符串 **不含** 令牌环境变量值。设 `AGENTICX_GATEWAY_INTERNAL_TOKEN=SECRET_SLO_TOKEN` 后 dump 仍不含 `SECRET_SLO_TOKEN`。

**AC-11：** `test_dispatch_file_wins_over_url`  
FILE 指向 fixture；URL 设为 `http://127.0.0.1:1/metrics`（不可达）。仍解析出 ttft，不得变成 `scrape_http_0` 且空 items。

**AC-12：** `test_get_channel_slo_description`  
description 含 `Read-only.`、`Never invent`、`Missing is not a root cause`、`Not the health score`。

**AC-13：** `test_smoke_ops_tools.py` 所有名称集合补上 `get_channel_slo`（默认开、env off、merge、visible_meta、STUDIO_TOOLS 不含）。与 `get_trace_parity` 同一批断言。

---

## 实施任务（按序，TDD）

### Task 1：Prom 解析

Create: `agenticx/ops/slo.py`（常量 + `parse_prom_text`）  
Test: AC-1/2/3

### Task 2：stats + build

同一文件：`parse_channel_stats` + `build_slo_rows`  
Test: AC-4..8

### Task 3：fetch + query

同一文件：`load_*` + `query_channel_slo`  
Test: AC-9、AC-11（可先单测 `query_channel_slo`）

### Task 4：工具 + 文案 + README

Modify: `tools.py`、`agent_tools.py` L9326、`RuntimeConfigSection.tsx` L50、`deploy/observability/README.md`  
Test: AC-10/12/13

### Task 5：回归

```bash
/opt/miniconda3/bin/python -m pytest \
  tests/test_smoke_gateway_slo.py \
  tests/test_smoke_trace_parity.py \
  tests/test_smoke_telemetry_query.py \
  tests/test_smoke_umodel.py \
  tests/test_smoke_ops_tools.py \
  tests/test_smoke_otel_hooks.py \
  -q --no-cov
```

**不要** `create_studio_app()`。不要改 `server.py`。不要改任何 `enterprise/apps/gateway/**/*.go`。

---

## no-scope-creep 边界

| 想顺手做的 | 为什么不准 |
|------------|------------|
| `TelemetryQuery.get_slo` | 破冻结 Protocol |
| 给 `SetChannelHealth` 接线 | 改运行时指标生产者；冷却已有 JSON |
| 用 health gauge 当冷却 | 该 gauge 线上从未 Set，会误报健康 |
| p95 / Grafana 面板 | Master 明确不做 Grafana 必选项 |
| 按 `session_id` 查 TTFT | Prom 没有该 label；加上即违反基数测试 |
| 写入 UModel `model_channel` | S3 允许空对象；本 plan 只查询 |
| 整段替换 `server.py` import | 历史事故 |
| 改体检公式 | 无关 |

---

## 验收总表

| AC | 测试 |
|----|------|
| AC-1..3 | `test_parse_prom_*` |
| AC-4..5 | `test_parse_channel_stats_*` |
| AC-6..8 | `test_build_slo_rows_*` |
| AC-9..12 | `query_*` / `dispatch_*` / description |
| AC-13 | `test_smoke_ops_tools.py` |

---

## 建议的下一步（不是本 plan）

- S7：调查拓扑
- S12：GPU 垂直（依赖本 plan 的查询习惯，不依赖本 plan 改 Go）
