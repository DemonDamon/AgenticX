---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise Gateway：Wasm 插件运行时 + 运维补完（自检 / 错误指纹 / Pyroscope / WAF）

- **Plan-Id**: 2026-05-21-enterprise-gateway-wasm-plugin-runtime
- **Plan-File**: `.cursor/plans/2026-05-21-enterprise-gateway-wasm-plugin-runtime.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-21
- **关联背景**:
  - [Higress Wasm Plugin](https://higress.cn/plugin/) + [proxy-wasm-go-sdk](https://github.com/higress-group/wasm-go) —— 多语言、热更新、沙箱隔离
  - [Tetrate wazero](https://wazero.io/) —— 纯 Go、无 CGO 的 WebAssembly 运行时（推荐选型）
  - [new-api 错误日志聚类](https://github.com/QuantumNous/new-api) —— 错误指纹便于运维
  - [Grafana Pyroscope](https://grafana.com/oss/pyroscope/) —— 持续 profiling
  - 关联 plan：本 plan 与 MCP plan、多协议 plan 解耦（不共改文件）；Cache plan 落地后 Wasm 可作为缓存策略的 hook 点

## 1. 背景与定位

### 1.1 为什么是 Wasm + 运维补完

Higress 在网关扩展性上的根本差异化是 **Wasm 插件运行时**：

| Higress Wasm | 客户价值 |
|---|---|
| 多语言（Go/Rust/JS/AssemblyScript） | 客户用熟悉语言写网关扩展 |
| 沙箱隔离 + 内存安全 | 单插件挂掉不影响网关主进程 |
| 热更新 | 配置/逻辑变更不重启进程，长连接 SSE 不掉 |
| 插件版本独立升级 | 多版本灰度 |

我们现在 `enterprise/plugins/` 只是 **YAML manifest 静态加载**——能描述策略包/工具包/主题包，但**无运行时**。要做"国产 enterprise AI 网关"，Wasm 运行时是绕不开的硬骨头。

同时把 new-api / Higress 散点提到但还没规划的运维细节一并补完：channel 自检 / 错误指纹聚类 / Pyroscope / 轻量 WAF。

### 1.2 现状盘点

| 模块 | 现状 | 涉及文件 |
|---|---|---|
| 插件 | YAML manifest 静态加载 | `enterprise/plugins/moderation-*/manifest.yaml` + `policy-engine` |
| Channel 自检 | 创建时手填 supported_models | `channel/registry.go` |
| 错误日志 | 普通日志 + 审计字段；无聚类 | `audit/writer.go` |
| Profiling | 无 | — |
| WAF | 无 | — |

## 2. 目标与非目标

### 2.1 目标（FR）

- **FR-1 Wasm 运行时引入**：选型 [wazero](https://wazero.io/)（纯 Go 无 CGO，单二进制部署不变）；在 gateway 进程内启 Wasm runtime；每个插件独立 module instance，按 tenant 隔离。
- **FR-2 插件 ABI**：定义子集 ABI（参考 proxy-wasm 子集，避免完整 envoy 依赖）：
  - `on_plugin_start(config_bytes)` → `int32`
  - `on_request_headers(headers)` → `Action`
  - `on_request_body(body, end_of_stream)` → `Action`
  - `on_response_headers(headers)` → `Action`
  - `on_response_body(body, end_of_stream)` → `Action`
  - `on_stream_chunk(chunk_bytes)` → `Action`（AI 流场景）
  - host functions：`get_property` / `set_property` / `audit_log` / `metrics_inc` / `http_call`（受白名单约束）
- **FR-3 插件 manifest 演进**：`plugins/<name>/manifest.yaml` 增字段：
  ```yaml
  runtime: wasm           # 与现有 declarative 并存
  wasm:
    binary: plugin.wasm
    config_schema: schema.json
    host_capabilities: [audit_log, metrics_inc]   # 白名单
  enabled: true
  scope: { tenant_ids: ['*'], routes: ['/v1/*'] }
  ```
- **FR-4 热加载**：监听 `plugins/` 目录（fsnotify）+ admin 上传；新版本加载验证（schema check + dry-run 单元）通过后原子切换 instance；旧 instance 优雅退役（等待 in-flight 请求结束）。
- **FR-5 内置示范插件**（伴随框架交付，作为参考实现 + 回归保护）：
  - `wasm-keyword-rewrite`（Go）：响应中关键词替换
  - `wasm-bearer-extractor`（Rust）：从 header 提取自定义 token 写入 property
  - `wasm-audit-tagger`（Go）：按 tenant 自定义 tag 写入审计字段
  - `wasm-waf-basic`（Go）：FR-9 的实现载体
- **FR-6 Admin 插件 UI**：`/admin/plugins` 页：列表 / 上传 wasm / 查看配置 schema / per-tenant 启停 / 版本回滚 / 健康（最近调用数 + 错误数 + p50）。
- **FR-7 Channel 自检（new-api 借鉴）**：创建/编辑 channel 时一键"探活"按钮，网关 → 上游 `GET /v1/models`（或对应协议同义接口）拉取 model 列表，自动回填 `supported_models`；同时校验 `key_pool` 中每把 key 的 401/403 健康。
- **FR-8 错误指纹聚类（new-api 借鉴）**：上游错误响应 → `errors/fingerprint.go` 抽取 `(status, error.type, normalized_message)` 计算 fingerprint hash；admin `/admin/errors` 展示按指纹聚类的 top errors、首次/末次出现时间、影响请求数、命中 channel。
- **FR-9 轻量 WAF**（Higress 借鉴）：内置基础规则：
  - prompt injection 关键词（`ignore previous instructions` 等可配）
  - SQL/XSS 经典 pattern
  - 单 IP / 单 PAT CC 防护（请求数突发）
  - 实现为 wasm-waf-basic 插件（吃 FR-1~FR-5 自身的能力，dogfooding）
- **FR-10 Pyroscope 集成（new-api 借鉴）**：可选启用 `PYROSCOPE_URL` 等 env 后接入持续 profiling；admin `/admin/perf` 仅显示 Pyroscope 链接（不二次实现 UI）。

### 2.2 非功能（NFR）

- **NFR-1 性能**：Wasm 插件单次 hook 调用开销 ≤ 50µs（wazero JIT 后）；含 4 个插件时端到端 p95 退化 ≤ 5%。
- **NFR-2 安全**：host function 白名单严格；插件不能直接发任意 HTTP（需 `http_call` capability 显式声明，admin 审核）；不能访问宿主文件系统。
- **NFR-3 兼容**：现有 declarative manifest（rule-pack/tool-pack/theme-pack）继续工作；wasm runtime 仅作为新增 runtime 类型，不强制迁移。
- **NFR-4 私有化**：wazero 无 native 依赖，单二进制不变；Pyroscope / WAF 等附属能力全可选关闭。
- **NFR-5 可观测**：每个 Wasm 插件单独导出 `agx_plugin_invocations_total{plugin}` / `agx_plugin_errors_total{plugin}` / `agx_plugin_latency_seconds{plugin}`。

### 2.3 验收（AC）

- **AC-1**：放入示范 `wasm-keyword-rewrite` 插件并启用，模型响应中 "secret-keyword" 被替换为 "[REDACTED]"；审计事件含 `plugins_invoked=[wasm-keyword-rewrite]`。
- **AC-2**：热加载验证：发布插件 v1 → 跑 100 路 SSE 流 → 上传 v2 → 30s 内完成切换，**老连接全部走完 v1**，新连接走 v2；无连接断开。
- **AC-3**：插件 panic 自动隔离：故意做一个崩溃插件，触发后 instance 自动 disable + 写 `audit_log` 记录，主网关请求不受影响。
- **AC-4**：Channel 自检按钮：创建 DeepSeek channel 后点 "探活"，自动填 `supported_models=["deepseek-chat","deepseek-reasoner",…]`，并标 key 健康状态。
- **AC-5**：连续触发同类 401 错误 5 次后，`/admin/errors` 出现一条聚合记录 `count=5 / fingerprint=xxx / last_seen=…`，点开能看到关联请求 ID 列表。
- **AC-6**：开启 `wasm-waf-basic`，prompt 中含 `ignore previous instructions` 命中 → 返回 `policy:waf:prompt_injection`；命中事件进审计链。
- **AC-7**：单测 `wasmhost/runtime_test.go`、`wasmhost/abi_test.go`、`errors/fingerprint_test.go`、`channel/probe_test.go`；性能基线 `scripts/perf-wasm-plugins.sh` 退化 ≤ 5%。

### 2.4 非目标（明确不做）

- ❌ **不**实现完整 proxy-wasm ABI 全集（envoy 体量）——只挑 AI 网关必要子集。
- ❌ **不**做 Wasm 插件市场 / 公网分发 / 数字签名分发（私有化场景；客户走 admin 上传即可）。
- ❌ **不**做完整 ModSecurity / OWASP CRS 风格的 WAF（只内置基础规则集；客户高合规需求另开 plan）。
- ❌ **不**做 OpenTelemetry tracing（独立 plan；本 plan 仅 Pyroscope continuous profiling）。
- ❌ **不**对 Wasm 插件提供 Rust / JS 一等公民工具链（Go SDK 优先，其他语言只要 abi 兼容即可跑）。

## 3. 架构设计

### 3.1 模块

```
enterprise/apps/gateway/internal/
├── wasmhost/                   ★ 新包
│   ├── runtime.go              wazero 实例 + 模块缓存
│   ├── abi.go                  host functions 实现 + 白名单
│   ├── instance.go             插件 instance 生命周期
│   ├── loader.go               manifest + .wasm 加载 + 校验
│   ├── reload.go               fsnotify + 原子切换
│   └── sandbox.go              panic 隔离 + resource limit
├── errors/                     ★ 新包
│   └── fingerprint.go          错误指纹算法
├── channel/
│   └── probe.go                ★ 自检
└── server/
    └── plugin_chain.go         ★ 编排 wasm 插件 + declarative 包
```

### 3.2 插件链编排

```
request → auth → policy
       → wasm: on_request_headers
       → wasm: on_request_body
       → channel.Pick → adaptor.Stream
       → wasm: on_stream_chunk (per chunk)
       → wasm: on_response_headers
       → wasm: on_response_body
       → audit
```

每个 hook 按 manifest `priority` 排序；任一 wasm 插件返回 `Action.Continue` / `Continue` / `Stop`（终止链并直接回响应）。

### 3.3 错误指纹算法

```
fingerprint = blake2b_short(
  status_code +
  upstream_error_type +    // 'rate_limit_exceeded' / 'invalid_api_key' / 'quota_exceeded'
  normalize(error_message)  // strip request-id, timestamps, numbers > 4 digits
)
```

聚类窗口：滑动 24h，per `(tenant_id, fingerprint)`。

### 3.4 Channel 自检流程

1. admin 点 "探活"
2. 网关用 channel.metadata 中第一把 healthy key 调上游 `GET /v1/models` / `:listModels`（按 provider_type 路由）
3. 解析模型列表 → 写入 `gateway_channels.supported_models`
4. 对 key_pool 中每把 key 调 `min-trial`（如 OpenAI `models?limit=1`），返回 401 / 403 → 标 unhealthy；成功 → 标 healthy + 记 `last_probe_at`
5. 失败原因写入 channel `last_probe_error`，admin UI 显示

## 4. 实施分期

| 阶段 | 周期感 | 交付物 | 前置 |
|---|---|---|---|
| **P0 Wasm runtime + ABI 子集** | 2 周 | `wasmhost/` 包 + 1 个示范 Go 插件（keyword-rewrite） | — |
| **P1 manifest 演进 + 热加载** | 1 周 | runtime 字段 + fsnotify + admin 上传接口 | P0 |
| **P2 Admin 插件 UI + 指标** | 1 周 | `/admin/plugins` + per-plugin Prometheus | P0/P1 |
| **P3 Channel 自检** | 0.5 周 | `channel/probe.go` + admin 按钮 | Channel plan 已落 |
| **P4 错误指纹聚类** | 1 周 | `errors/fingerprint.go` + `/admin/errors` UI | — |
| **P5 WAF 基础插件 + Pyroscope** | 1 周 | `wasm-waf-basic` 用 Wasm 写 + Pyroscope env 接入 | P0 |
| **P6 加固与文档** | 1 周 | 插件开发者文档、回归脚本、`docs/runbooks/wasm-plugins.md` | 全 |

总周期 ~7.5 周。建议放在 MCP / 多协议 / 缓存三大 plan 之后启动（它属于"长期扩展性投入"，不在最近 90 天对外演示路径里最关键）。

## 5. 测试与验证

- **单测**：`wasmhost/runtime_test.go`（启动 / 加载 / 反复 reload 内存稳定）、`wasmhost/abi_test.go`（host function 边界 + 白名单拒绝）、`wasmhost/sandbox_test.go`（panic 隔离 + resource limit 触发）
- **集成**：`scripts/e2e-wasm.sh` 起 gateway → 上传 4 个示范插件 → 跑 chat + MCP（如 plan 1 已上）→ 验证插件按顺序执行 + 审计含插件链
- **性能**：`scripts/perf-wasm-plugins.sh`：0 插件 / 1 插件 / 4 插件三档对比，p95 退化 ≤ 5%
- **稳定**：`scripts/chaos-wasm.sh`：注入 panic、OOM、死循环（resource limit）

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| wazero 性能不及 envoy + V8 | 提前压测；必要时引入 wasmtime（CGO）作为可选 runtime；默认 wazero 单二进制 |
| 插件死循环 / OOM | wazero 支持 instruction counter + memory limit，超阈值杀 instance |
| Host function 误开放导致越权 | 白名单严格；admin 上架时强制 review；默认无 `http_call` |
| 热加载竞态 | 双 buffer 切换 + 引用计数；老连接读老 instance |
| WAF 误杀 | 默认 `warn` 模式，admin 显式切 `block` |
| Pyroscope 拖性能 | 默认采样率低 + 仅 env 配置时启用 |

**回退**：`GATEWAY_WASM_PLUGINS=off` 关闭整个 runtime；声明式 manifest 路径不受影响。

## 7. 与对照对象的能力对齐

| Higress Wasm | 本 plan |
|---|---|
| Go/Rust/JS/AssemblyScript | ✅ ABI 兼容（Go SDK 一等公民） |
| 沙箱隔离 + 内存安全 | ✅ FR-1/NFR-2 |
| 热更新无损 | ✅ FR-4 |
| 流式 SSE hook | ✅ FR-2 `on_stream_chunk` |
| 完整 proxy-wasm ABI 全集 | ❌ 仅子集 |

| new-api 运维 | 本 plan |
|---|---|
| Channel 自检 + model list 拉取 | ✅ FR-7 |
| 错误日志表 + 指纹 | ✅ FR-8 |
| Pyroscope 接入 | ✅ FR-10 |
| 兑换码 / Stripe | ❌ 不做 |

## 8. 文档与归档

- `enterprise/docs/runbooks/wasm-plugins.md`（运维）
- `enterprise/docs/architecture/plugin-runtime.md`（设计 + ABI 规范）
- `docs/guides/write-your-first-wasm-plugin.md`（开发者文档 + Go SDK 模板）
- 合规：wazero (Apache 2.0) 可商用；不复制 Higress wasm-go SDK 源码，按 proxy-wasm 公开规范子集自研

## 9. 待澄清问题

1. **wazero vs wasmtime 选型**：当期建议 wazero（单二进制不变）；若压测显示明显瓶颈再加 wasmtime 可选。
2. **WAF 规则是否长期内置 vs 走 wasm 插件**：建议长期走 wasm（dogfooding）；基础规则集即首批官方插件。
3. **Pyroscope 是否企业版默认部署**：建议默认不部署、仅 env 启用；客户场景再单独配。
4. **Channel 自检是否对所有 provider_type 普适**：当前已知 OpenAI 兼容 / Anthropic / Gemini 都有 list-models 同义接口；私有 / 自定义协议在 probe 失败时给提示，不阻断创建。

---

**Made-with: Damon Li**
