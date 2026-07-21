# AgenticX Enterprise edge-agent 模块总结

> 结论生成时间：2026-07-21（基于 clean worktree 当前代码重写，覆盖 v0.2.0）

> 说明：本文档描述 **Enterprise 端侧 Edge Agent**（部署在员工桌面/边缘节点的 Go sidecar），定位为 Machi Desktop ↔ AgenticX Gateway 之间的本地代理与沙箱执行器。与主仓 `agenticx/cc_bridge`（桌面端 Claude Code 桥）、`agenticx/sandbox`（框架内沙箱）不同：本模块是企业级独立 Go 二进制，强调"端侧沙箱执行 + 词元追踪"。**历史背景**：`.cursor/plans/2026-06-05-edge-agent-sandbox-token-trace.plan.md` 将其从"约 33 行空壳 skeleton"落地为当前 MVP；AGENTS.md 中"packaging/edge-agent 仅 33 行空壳"的旧表述已过时（`packaging/edge-agent` 路径已不存在），当前实现全部在 `enterprise/apps/edge-agent`。

## 定位与真实完成度

`apps/edge-agent` 是 Go 1.22 编写的小型 sidecar 二进制（v0.2.0），运行在员工桌面/边缘节点，默认监听 `127.0.0.1:7420` 暴露本地 HTTP API。它接收多步骤智能体任务请求，在**隔离的临时工作区沙箱**中执行（write / exec / model 三类步骤），把 model 步骤通过 **AgenticX Gateway** 转发到上游（携带 `X-AgenticX-Trace-Id` / `X-AgenticX-Trace-Step` 头部用于全链路追踪），并把每步的 **trace span** 以 JSONL 形式落本地、可选上送 admin-console。**零运行时第三方依赖**（仅 Go 标准库，`go.mod` 无 require，无 `go.sum`）。

**诚实判定**：当前是"**沙箱 + 词元追踪 MVP**"，不是 skeleton，但也远未达到 README 蓝图描绘的完整端侧安全闭环。核心闭环（沙箱执行 + trace 落盘 + 网关转发 + span 上送）已真实落地并有单测；README 第 1-10 节大量 ✅ 项（mTLS / Ed25519 自升级 / 限流 / checksum 链 / 脱敏引擎 / Ollama 代理 / Workspace REST API 等）**仅是蓝图，代码中不存在**。Desktop 客户端集成**未接线**。Ingest 上送存在 token 字段 schema 不匹配（见下文）。

## 目录结构（实际磁盘）

```
apps/edge-agent/
├── cmd/edge-agent/main.go           # 二进制入口：环境变量装配 + token 引导（97 行）
├── internal/
│   ├── api/server.go                # HTTP server + Bearer 中间件 + 4 个路由（96 行）
│   ├── gateway/client.go            # 出站：→ Gateway /v1/chat/completions（108 行）
│   ├── ingest/client.go             # 出站：→ admin-console trace ingest（61 行）
│   ├── runner/runner.go             # 多步任务执行器（model / exec / write）（160 行）
│   ├── runner/runner_test.go        # 单测：mock gateway + 两步 trace 聚合（149 行）
│   ├── sandbox/sandbox.go           # 隔离 tmp 工作区 + 路径逃逸保护 + RunCommand（153 行）
│   ├── sandbox/sandbox_test.go      # 单测：路径越权 / 超时（99 行）
│   ├── trace/model.go               # Span / Trace / Usage 类型 + 聚合（86 行）
│   ├── trace/store.go               # JSONL append-only span store（117 行）
│   └── trace/store_test.go          # 单测（34 行）
├── pkg/                             # 空目录（当前无导出包）
├── docs/
│   ├── security-model.md            # STRIDE + MITRE ATT&CK 威胁模型（142 行）
│   └── supply-chain.md              # 依赖白名单策略（46 行，反映"零依赖"现状）
├── go.mod                           # module github.com/agenticx/enterprise/edge-agent，go 1.22，无 require
├── Makefile                         # build / build-reproducible / test / vet / vuln / sbom（40 行）
└── README.md                        # 架构、部署、API 契约（236 行）
```

> README 提到的规划包（`internal/router`、`internal/ollama`、`internal/redact`、`internal/uploader`、`internal/security`、`pkg/types`、`docs/api.md`、`go.sum`）**在 v0.2 均未实现**——属于已落档的下一阶段路线图，README 目录结构与实际磁盘不符。

## 核心组件分析

### 二进制入口 (cmd/edge-agent/main.go)

**关键行为**：
- 强制要求 `EDGE_AGENT_ENABLED=1`（或 true/yes）才会启动，否则 exit 0（避免误装即跑）—— `main.go:27-30`
- 默认绑定 `127.0.0.1:7420`，**绝不绑 0.0.0.0** —— `main.go:32-36`
- 若 `EDGE_AGENT_TOKEN` 未设置 → `crypto/rand` 生成 16 字节随机 token（前缀 `agx-edge-`）写入 `~/.agenticx/edge.token`（mode 0600）—— `main.go:57-65`
- 版本常量 `Version = "0.2.0"` —— `main.go:24`

**环境变量**：
| 变量 | 用途 | 默认 |
|---|---|---|
| `EDGE_AGENT_ENABLED` | 启动开关（必须为 `1`） | — |
| `EDGE_AGENT_PORT` | HTTP 端口 | `7420` |
| `EDGE_AGENT_HOST` | 绑定地址 | `127.0.0.1` |
| `AGX_HOME` | 数据根目录 | `~/.agenticx` |
| `EDGE_AGENT_GATEWAY_URL` | Gateway 基址 | — |
| `EDGE_AGENT_GATEWAY_TOKEN` | Gateway Bearer | — |
| `EDGE_AGENT_COMMAND_TIMEOUT_MS` | 沙箱命令超时 | 30000 |
| `EDGE_AGENT_TRACE_INGEST_URL` | admin-console 上送地址 | — |
| `EDGE_AGENT_TRACE_INGEST_TOKEN` | 上送 Bearer | — |

### HTTP 服务 (internal/api/server.go)

基于 Go 1.22 `http.ServeMux` 的最小 HTTP 服务 + Bearer 鉴权中间件。

**路由**：
| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/healthz` | ❌ | 存活检查 `{status, time}` |
| POST | `/v1/tasks/run` | ✅ | 提交 `RunRequest` 多步骤任务，返回 `RunResult` |
| GET | `/v1/traces` | ✅ | 列出最近 100 个 trace_id |
| GET | `/v1/traces/{id}` | ✅ | 拉取聚合后的 `Trace` |

`authMiddleware`（`server.go:32-45`）对 `/healthz` 以外所有路由强制 `Authorization: Bearer <token>`（大小写不敏感比较）。

> README 中规划但**尚未实现**的端点：`POST /v1/chat/completions`（Ollama 本地代理）、`POST /v1/workspace/{read,write,list}`、`GET /v1/status`、`POST /v1/audit/ingest`。

### 任务执行器 (internal/runner/runner.go)

把多步骤 `RunRequest` 在沙箱里跑出一条 `Trace`。

**关键类型**：
- `Step{StepNo, Kind, Model, Prompt, Command, RelPath, Content}` —— `runner.go:21-29`
- `RunRequest{TraceID, Steps}` / `RunResult{Trace}` —— `runner.go:31-38`
- 接口 `ModelCaller.Complete(ctx, traceID, stepNo, model, prompt) Usage` → 由 `gateway.Client` 实现 —— `runner.go:17-19`
- 接口 `SpanIngester.PushSpans(ctx, spans)` → 由 `ingest.Client` 实现 —— `runner.go:47-49`
- 编译期断言 `var _ ModelCaller = (*gateway.Client)(nil)` —— `runner.go:160`

**执行流**（`runner.go:59-87`）：每个 step 按 `Kind`（`model`/`write`/`exec`）路由 → 构造带计时的 `trace.Span` → 落 `Store` → 全部执行完后聚合返回。沙箱错误经 `classifySandboxErr`（`runner.go:135-143`）映射到 `StatusFailed`/`StatusTimeout`。ingest 错误被**忽略**（`runner.go:83-85`，fire-and-forget）。

### 沙箱 (internal/sandbox/sandbox.go)

每次启动用 `os.MkdirTemp` 建一个临时工作区，所有 IO/命令限定在内。

**关键方法**：
- `ResolvePath`（`sandbox.go:69-102`）—— **三阶段路径校验**：`Clean` → `EvalSymlinks`（root 与 target 都解符号链接）→ `Rel` 检查 `..` 前缀；防符号链接逃逸
- `WriteFile`/`ReadFile` —— 写入用 0600 / 目录 0700
- `RunCommand`（`sandbox.go:130-153`）—— `exec.CommandContext`，**环境变量被洗白**为只剩 `PATH/HOME=workDir/TMPDIR=workDir`；超时返回 `context.DeadlineExceeded`；输出截断到 `MaxOutputBytes`
- `Close` —— `RemoveAll` 临时目录

**Config**：`CommandTimeout` 默认 30s，`MaxOutputBytes` 默认 1 MiB（`sandbox.go:25-30`）。

### 追踪存储 (internal/trace/{model,store}.go)

**model.go**：常量 `StepKindModel/Exec/Write`、`StatusOK/Failed/Timeout`；`Usage{InputTokens, OutputTokens, ReasoningTokens, TotalTokens, CostUSD}`（**注意：JSON tag 为 `usage` 嵌套对象**，`model.go:16-22` + `model.go:33`）；`Span`/`Trace`；工具 `SumUsage`、`AggregateTrace`。

**store.go**：mutex 守护的 JSONL append-only 存储；默认路径 `<AGX_HOME>/edge-agent/traces.jsonl`；方法 `NewStore`、`AppendSpan`、`ListTraceIDs(limit)`、`GetTrace(id)`。**仅普通 append，无 checksum 链**（与 README "append-only + checksum 链（类 Git blake2b）" 不符）。

### Gateway 客户端 (internal/gateway/client.go)

把 model 步骤转发到企业 Gateway，并埋链路头。

- `Client{baseURL, token, httpClient(timeout=120s)}`
- 常量 `HeaderTraceID = "X-AgenticX-Trace-Id"`、`HeaderTraceStep = "X-AgenticX-Trace-Step"`（`client.go:17-20`）
- `Complete`（`client.go:58-108`）—— POST OpenAI 形状 body `{model, messages:[{role:user,content:prompt}], stream:false}` 到 `<baseURL>/v1/chat/completions`，提取 `usage.prompt_tokens/completion_tokens/total_tokens`；`total_tokens` 缺失时回退为 prompt+completion

### Ingest 客户端 (internal/ingest/client.go)

把 span fire-and-forget 上送 admin-console。

- `Client{url, token, httpClient(timeout=10s)}`
- `Enabled()` —— 仅当 `url` 非空时启用
- `PushSpans`（`client.go:35-61`）—— POST `{spans:[...]}` 到 admin-console `/api/agent-traces/ingest`
- runner 中**忽略错误**（不影响主流程）

## 安全模型（docs/security-model.md 摘要）

**框架**：STRIDE + MITRE ATT&CK。审阅频率：每季度 + release 前。

**资产分级**：🔴 极高 A1 原始 prompt/response、A2 工作区文件（永不出端）；🟠 高 A3 Bearer token、A4 脱敏规则；🟡 中 A5 审计日志、A6 token/cost 统计、A7 二进制。

**STRIDE 对策（与 v0.2 实际实现对照）**：
| 威胁类 | README 蓝图对策 | 实际实现 |
|---|---|---|
| Spoofing | Bearer token + Ed25519 自升级签名 | ✅ token；❌ 自升级未实现 |
| Tampering | append-only + checksum 链 | ❌ 仅普通 append JSONL，无 checksum 链 |
| Repudiation | 不可抵赖日志 | 部分（无 checksum 链） |
| Info Disclosure | 强制脱敏 + `mlock` + 禁 core dump | ❌ 脱敏 `internal/redact` 未实现 |
| DoS | 100 连接 + 10 QPS + 10MB body + 60s 超时 | ❌ 限流未实现 |
| Elevation | 三阶段路径校验 + 无 shell-exec + 非 root + CAP_DROP | ✅ 路径校验；其余部署侧未在代码强制 |

**MITRE ATT&CK 覆盖**：T1005 / T1041 / T1059 / T1140 / T1190 / T1546（全部已设计对策，多数尚未落地）。

**合规对照**：PIPL · GB/T 22239-2019 等保 2.0 三级 · GDPR Art.25 · ISO 27001 A.12.4 · ISO 42001。

## 对外 API 表面

**入站 HTTP** —— `127.0.0.1:7420`，`/healthz` 外都需要 `Authorization: Bearer <token>`：

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| GET | `/healthz` | — | `{status, time}` |
| POST | `/v1/tasks/run` | `RunRequest{trace_id?, steps:[{step_no, kind, model?, prompt?, command?, rel_path?, content?}]}` | `RunResult{trace:Trace}` |
| GET | `/v1/traces` | — | `{trace_ids:[...]}` |
| GET | `/v1/traces/{id}` | — | `Trace` |

**出站 HTTP**：
- → **Gateway** `POST {EDGE_AGENT_GATEWAY_URL}/v1/chat/completions`（携带 `X-AgenticX-Trace-Id/Step`）
- → **Admin Console** `POST {EDGE_AGENT_TRACE_INGEST_URL}` 上送 `{spans:[...]}`

**Go 导出表面**：`pkg/` 为空 —— 当前**无对外可 import 的 Go API**，所有集成走 HTTP。

## 部署模型（与 Machi / Gateway 的关系）

```
Machi Desktop ──IPC 127.0.0.1+Bearer──▶ Edge Agent (Go) ──▶ (规划) Ollama 本地代理
                                              │
                                              ├── HTTPS ──▶ AgenticX Gateway (/v1/chat/completions)
                                              └── HTTPS ──▶ Admin Console (/api/agent-traces/ingest)
```

**关键约束（README 蓝图，部分未落地）**：
- **每用户 sidecar**：systemd（Linux 专属 `agenticx-edge` 用户）/ macOS LaunchAgent / Windows NSSM；**永不 root，永不 0.0.0.0**
- **Gateway 角色**：承担上游 provider 路由 / 配额 / 计费；通过 trace 头与 Edge Agent 的 span 联表对账
- **Admin Console 角色**：只收 **span 摘要**（不收原始 prompt）做企业级观测

**构建/发布**（`Makefile` 真实存在）：
- `make build-reproducible`：`CGO_ENABLED=0 -trimpath -ldflags="-s -w -buildid="` → 可复现单一静态二进制
- `make sbom`：syft 生成 CycloneDX SBOM
- `make vuln`：`govulncheck` 高危扫描
- 对齐"客户 A 技术规范书 V20260422 §1.5(2)：端侧本地模型路由 / 数据不出网关"验收项

## 与 Enterprise 其他模块的真实关系

| 关联 | 形态 | 真实状态 |
|---|---|---|
| `apps/gateway` | 出站 HTTP | ✅ **真实**。`gateway/internal/server/server.go:641` 注册 `POST /v1/chat/completions`；`gateway/internal/server/trace_context.go` 读取 `X-AgenticX-Trace-Id/Step` 头。`enterprise/deploy/gateway/hybrid/channels.example.json` 等把 `edge-agent` 作为 `route: local` 的 providerLabel，说明网关侧已把 edge-agent 视为合法本地通道 |
| `apps/admin-console` | 出站 HTTP | ⚠️ **部分真实，有 schema 不匹配**。`admin-console/src/app/api/agent-traces/ingest/route.ts` 真实存在（`metering:manage` scope），`app/metering/agent-traces/page.tsx` 真实渲染。**但**：ingest 路由读 `item.input_tokens/output_tokens/total_tokens/cost_usd/reasoning_tokens`（**扁平顶层**），而 edge-agent 的 `trace.Span` 把这些字段**嵌套在 `usage` 对象下**（`trace/model.go:33`）。结果：span 能落库，但 **token/cost 字段在 admin 侧会全部归零**；trace_id/step_no/step_kind/status/model/provider/duration_ms/metadata 映射正常 |
| Machi Desktop（主仓 `desktop/`） | 本地 IPC | ❌ **未接线**。在 `desktop/` 全量检索 `edge.token` / `edge-agent` / `EDGE_AGENT` / `7420` / `/v1/tasks/run` 均**零命中**。README 称"Machi 是唯一预期客户端"属规划，当前 Desktop 实际链路为 Electron → 内嵌 `agx-server`（PyInstaller Python 后端，随机端口）→ Ollama，**不经** edge-agent |
| 主仓 `agenticx/sandbox` | 无代码依赖 | 概念相似但独立实现；本模块零第三方依赖 |
| 主仓 `agenticx/cc_bridge` | 无代码依赖 | 都做"桌面侧 Bearer 保护本地 HTTP"，但定位/协议不同 |

## v0.2 现状 vs 路线图

| 能力 | v0.2 状态 | 证据 |
|---|---|---|
| 沙箱工作区 + 三阶段路径校验 | ✅ | `sandbox/sandbox.go:69-102`，有单测 |
| Bearer 鉴权 + 启动轮换 token | ✅ | `main.go:57-65` + `api/server.go:32-45` |
| Span 落 JSONL | ✅ | `trace/store.go`，append-only 但无 checksum 链 |
| Gateway 转发 + trace 头 | ✅ | `gateway/client.go:58-108`，OpenAI 形状 |
| Ingest 上送 | ⚠️ | `ingest/client.go` fire-and-forget；**token 字段 schema 与 admin 不匹配** |
| 脱敏 (`internal/redact`) | ❌ | 规划中，目录不存在 |
| 限流 / 连接数 / body 上限 | ❌ | 规划中 |
| 自升级 + Ed25519 签名 | ❌ | 规划中 |
| Ollama 本地代理 (`/v1/chat/completions`) | ❌ | 规划中（README 已写契约） |
| Workspace REST API (`/v1/workspace/*`) | ❌ | 规划中 |
| `pkg/types` 导出 Go 客户端 SDK | ❌ | `pkg/` 为空 |
| Desktop 客户端集成 | ❌ | `desktop/` 无任何 edge-agent 调用 |

## 边界

**In scope（v0.2 已交付）**：
- 受限子进程沙箱（隔离工作目录 / 超时 / 输出截断 / 环境洗白 / 路径逃逸保护）
- 多步骤 agent 任务执行（model / exec / write 三类 step）
- 本地 JSONL trace 落盘 + 聚合查询
- 经企业 Gateway 转发 model 步骤并埋 trace 头
- 可选 span 上送 admin-console（fire-and-forget）

**Out of scope（v0.2 未交付，属 README 蓝图）**：
- 本地 Ollama 推理代理 / 流式 SSE
- Workspace 文件 REST API
- 脱敏引擎 / 限流 / mTLS / 自升级签名 / checksum 链
- `pkg/types` Go SDK 导出
- Desktop 端实际接线（当前无客户端调用方）

**与主仓的边界**：本模块**不替代** Desktop 内嵌 `agx-server` 的本地后端链路；两者并行存在，edge-agent 是企业部署的可选独立 sidecar，默认不启用（需显式 `EDGE_AGENT_ENABLED=1`）。客户方案中"端侧闭环"若指 Desktop 本地推理，应描述 Machi 内嵌后端，**不应**直接套用 edge-agent 概念。

## 诚实判定总结

当前可认为是"**MVP + 安全骨架蓝图**"：核心闭环（沙箱执行 + trace 落盘 + 网关转发 + span 上送）已真实落地并有单测覆盖，是一个可独立 `go build` 的 ~878 行 Go 实现加 282 行测试的可用二进制；但 README 第 1-10 节描绘的纵深防御能力（脱敏 / 限流 / checksum 链 / mTLS / 自升级 / Ollama 代理 / Workspace API）**大部分仍停留在蓝图**，且 README 自身存在端口表述矛盾（line 13 写 `7420` 与代码一致，line 80 却写 `7823` + "随机分配端口"，均与代码固定 `7420` 不符）。Desktop 客户端**未接线**，ingest 上送存在 token 字段 schema 不匹配（admin 侧 token/cost 会归零）。**不宜在客户方案中作为"已完成的端侧安全闭环"对外承诺**，应表述为"沙箱 + 词元追踪 MVP，纵深防御能力按路线图推进"。
