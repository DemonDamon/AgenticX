---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise Gateway：多协议入站 + 跨格式转换 + Reasoning Effort

- **Plan-Id**: 2026-05-21-enterprise-gateway-multi-protocol-inbound
- **Plan-File**: `.cursor/plans/2026-05-21-enterprise-gateway-multi-protocol-inbound.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-21
- **关联背景**:
  - 调研对象：[QuantumNous/new-api](https://github.com/QuantumNous/new-api) —— 协议入站/转换是其最强运营价值
  - 上游规范：[Anthropic Messages API](https://docs.anthropic.com/en/api/messages)、[Google Gemini API](https://ai.google.dev/api/rest)、[OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
  - 关联 plan：`2026-05-19-enterprise-gateway-channel-relay.plan.md` —— Adaptor 接口已就位（`adaptor/stubs.go` Claude/Gemini 占位）

## 1. 背景与定位

### 1.1 为什么是协议入站 + 跨格式转换

new-api 在 Channel + Token 之外，**真正"行业头部"的能力是协议层的双向适配**：

| 能力 | 客户场景 |
|---|---|
| `/v1/messages` 入站 | Anthropic SDK 客户端无改造直连企业网关 |
| `/v1beta/models/.../generateContent` 入站 | Gemini SDK / LangChain ChatVertexAI 无改造直连 |
| OpenAI ⇄ Claude Messages 双向转换 | OpenAI 客户端调 Claude 上游 / Claude 客户端调 OpenAI 上游 |
| OpenAI → Gemini 单向转换 | 历史 OpenAI 应用代码切到 Gemini 模型不改业务 |
| Reasoning Effort 派生 model_id | 同一上游模型用 `gpt-5-high` / `gpt-5-low` 控制思考力度 |
| Thinking-to-content 流转换 | 把 `<thinking>` 块抽取为独立 `reasoning_content` 字段，前端透明 |

我们已经做了 Channel + Adaptor 框架（`adaptor.Adaptor` 接口 + `OpenAIAdaptor` 实装 + Claude/Gemini stubs），**协议入站和跨格式转换 = 把 stubs 升级为完整 adaptor + 增三个入站 handler**。

### 1.2 现状盘点

| 模块 | 现状 | 涉及文件 |
|---|---|---|
| 入站 handler | 仅 `/v1/chat/completions`、`/v1/embeddings` | `enterprise/apps/gateway/internal/server/server.go` |
| Adaptor 接口 | `Stream / Complete / Embeddings` 三方法 | `enterprise/apps/gateway/internal/adaptor/adaptor.go` |
| OpenAI Adaptor | 完整实装 | `adaptor/openai.go` |
| Claude/Gemini Adaptor | `not_implemented` 占位 | `adaptor/stubs.go` |
| Channel 选择 | 已就位（含 supported_models） | `channel/picker.go` |

## 2. 目标与非目标

### 2.1 目标（FR）

- **FR-1 入站 `/v1/messages`（Claude Messages）**：完整支持 `messages / system / tools / tool_choice / stream`，含 stop_sequences / max_tokens / temperature / top_p / top_k；返回符合 Anthropic SSE 规范（`message_start / content_block_start / content_block_delta / content_block_stop / message_delta / message_stop`）。
- **FR-2 入站 `/v1beta/models/{model}:generateContent` + `:streamGenerateContent`（Gemini）**：完整支持 `contents / systemInstruction / generationConfig / tools / safetySettings`；流式按 Gemini SSE 规范输出 `candidates[*].content` chunk。
- **FR-3 入站 `/v1/responses`（OpenAI Responses）**：最小可用集——支持 `input` 既可为 string 也可为 message 数组、`instructions`、`tools`（function 类型）；流式 `response.output_text.delta` / `.done` 事件。完整 `previous_response_id` 多轮 = 下一阶段。
- **FR-4 跨格式转换矩阵**：
  - OpenAI ⇄ Claude Messages（**双向**完整，含 function/tools）
  - OpenAI → Gemini（完整）
  - Gemini → OpenAI（**文本**，function calling 仅 best-effort，明确告知）
  - 入站协议 × 上游 Channel 协议任意组合可达（缺位用"二段转换"：先转 OpenAI pivot 再转目标）
- **FR-5 Reasoning Effort 派生**：模型注册表识别 `*-high / *-medium / *-low` 后缀（OpenAI o3-mini / gpt-5 系列、Anthropic claude-3-7-sonnet-thinking、Gemini 2.5-* thinking + budget），自动剥离后缀并注入对应上游参数（`reasoning_effort=high` / `thinking={type:enabled, budget_tokens:N}` / `thinkingConfig.thinkingBudget`）。
- **FR-6 Thinking-to-Content 流转换**：可配置开关 `relay.thinking_to_content`：
  - **off**：原样透传（默认）
  - **separate**：抽到独立字段 `reasoning_content`（OpenAI 自定义） / `thinking` block（Claude 原生）
  - **merge**：拼回 `content`，但用 `<think>…</think>` 标签包裹，下游前端可统一解析
- **FR-7 完整流式语义保持**：所有跨协议转换在 SSE 流过程中**逐 chunk** 完成，不做"等全部完成后整体转换"——确保首 token 延迟（TTFT）不退化。
- **FR-8 Adaptor 完整化**：`ClaudeAdaptor` / `GeminiAdaptor` 从 stubs 升级为完整 Stream / Complete 实装（含工具调用回环）。

### 2.2 非功能（NFR）

- **NFR-1 内部 DTO 中立**：继续以 OpenAI 形态为 pivot（沿用 Channel/Relay plan NFR-4），所有入站协议先归一到内部 `*types.OpenAIRequest`，路由完成后再由 adaptor 按目标 channel 协议出站；跨协议转换器有且仅有 **`pivot ⇄ X`** 两类，避免 N×N 组合爆炸。
- **NFR-2 协议精度**：通过官方 SDK 的 e2e 测试（`@anthropic-ai/sdk` / `@google/genai` / `openai`）；不依赖私有 fixture 自欺。
- **NFR-3 性能**：单 chunk 转换函数 ≤ 100µs；整请求转换零额外内存分配（用 sync.Pool 复用 buffer）。
- **NFR-4 错误码标准化**：跨协议错误码映射表落 `adaptor/errors_map.go`（Anthropic `overloaded_error` → OpenAI `429 type=rate_limit_exceeded`，等等）。
- **NFR-5 审计字段**：新增 `inbound_protocol` / `outbound_protocol` / `reasoning_effort` / `thinking_mode`，不破坏链。

### 2.3 验收（AC）

- **AC-1**：用 `anthropic` 官方 Python SDK 配 `base_url=http://gateway/v1`、`api_key=agx-pat-…`，调用 `messages.create(model="deepseek-chat-claude-style", stream=True)`，能正常拿到 SSE chunk；网关把请求转到 OpenAI 兼容的 DeepSeek 上游。
- **AC-2**：用 `google-generativeai` Python SDK 配 `transport='rest'` + 自定义 endpoint，调 `gemini-1.5-pro-or-mapped` 流式生成，网关把请求转到 OpenAI 兼容上游或 Anthropic 上游。
- **AC-3**：用 OpenAI Python SDK 调 `gpt-5-high`，网关识别 `-high` 后缀路由到 OpenAI 上游并注入 `reasoning_effort=high`；调 `claude-3-7-sonnet-thinking`，注入 `thinking={type:enabled, budget_tokens:8192}`。
- **AC-4**：`relay.thinking_to_content=separate`，流式调用支持 thinking 的模型，响应里 `reasoning_content` 字段独立递增，`content` 不混入 thinking 文本。
- **AC-5**：单测 `adaptor/transform_test.go` 覆盖 OpenAI⇄Claude 双向（含 tools/tool_choice）、OpenAI→Gemini、Gemini→OpenAI 文本三 path，每个 path ≥ 6 个 case。
- **AC-6**：集成测试 `relay/multi_protocol_integration_test.go` 起 mock 上游（OpenAI/Claude/Gemini 三协议），三入站 × 三上游 = 9 组合矩阵全通过（含流式）。
- **AC-7**：性能回归 `scripts/perf-protocol-translate.sh`：相比 OpenAI⇄OpenAI 直通，跨协议转换 TTFT 退化 ≤ 15%，总耗时退化 ≤ 8%。

### 2.4 非目标（明确不做）

- ❌ **不**做 Realtime API（WebSocket）入站——独立子能力，复杂度高，与本 plan 解耦。
- ❌ **不**做 Image / Audio / Video / Rerank / Midjourney / Suno 入站。
- ❌ **不**做 `/v1/responses` 完整 `previous_response_id` 多轮链路（仅最小集）；如需完整支持单开 plan。
- ❌ **不**支持 Gemini→OpenAI 的 function calling 完整双向（best-effort 文本注释）；如需独立 plan。
- ❌ **不**支持 Anthropic `tool_use_id` / `cache_control` 细粒度精确语义（cache_control 由 Plan 3 cache 体系吸收）。

## 3. 架构设计

### 3.1 数据流（以入站 Claude Messages → 上游 OpenAI 兼容为例）

```
Anthropic SDK
    │ POST /v1/messages  (Claude wire format, stream=true)
    ▼
gateway: handleClaudeMessages
    │
    ▼
inbound.ClaudeToOpenAI(req) → *OpenAIRequest (pivot)
    │
    ▼
policy.Evaluate(req)
    │
    ▼
channel.Pick(model, identity) → Channel(OpenAI 协议)
    │
    ▼
adaptor.OpenAIAdaptor.Stream(req, channel, push)
    │ (SSE chunk-by-chunk)
    ▼
outbound.OpenAIToClaude(chunk) → Anthropic SSE event
    │
    ▼
client (Anthropic SDK 透明解析)
```

入站 Gemini → 上游 Claude 协议则走两段：`GeminiToOpenAI → (pivot) → OpenAIToClaude`，但**在流式 pipeline 里只链一次**：注册转换链 `GeminiToClaude = compose(GeminiToOpenAI, OpenAIToClaude)`，运行时不二次解析。

### 3.2 包结构

```
enterprise/apps/gateway/internal/
├── adaptor/                    现有
│   ├── adaptor.go              接口
│   ├── openai.go               已实装
│   ├── claude.go               ★ stubs → 完整
│   ├── gemini.go               ★ stubs → 完整
│   ├── stubs.go                清理
│   └── errors_map.go           ★ 新增
├── inbound/                    ★ 新包
│   ├── openai.go               passthrough
│   ├── claude.go               Claude Messages → pivot
│   ├── gemini.go               Gemini generateContent → pivot
│   └── responses.go            OpenAI Responses → pivot（最小集）
├── outbound/                   ★ 新包
│   ├── openai.go               passthrough
│   ├── claude.go               pivot → Claude SSE
│   ├── gemini.go               pivot → Gemini SSE
│   └── responses.go            pivot → Responses SSE
├── transform/                  ★ 新包（chunk 级流式转换）
│   ├── reasoning_effort.go     model 后缀派生
│   ├── thinking.go             thinking-to-content
│   └── tools_mapping.go        function/tool 双向
└── server/server.go            handler 接线
```

### 3.3 关键接口

```go
// inbound：把不同协议归一到 pivot
type InboundParser interface {
    Protocol() string
    Parse(r *http.Request) (*types.OpenAIRequest, error)
}

// outbound：把上游 chunk 转目标协议
type OutboundEncoder interface {
    Protocol() string
    EncodeChunk(c types.PivotChunk) ([]byte, error)
    EncodeFinal(usage types.Usage) ([]byte, error)
}

// adaptor：现有，向上游发请求并产出 PivotChunk
```

### 3.4 Reasoning Effort 后缀派生表（节选）

| 派生 model | 上游 model | 注入参数 |
|---|---|---|
| `o3-mini-high` | `o3-mini` | `reasoning_effort=high` |
| `gpt-5-low` | `gpt-5` | `reasoning_effort=low` |
| `claude-3-7-sonnet-thinking` | `claude-3-7-sonnet-20250219` | `thinking={type:enabled, budget_tokens:8192}` |
| `gemini-2.5-flash-thinking-128` | `gemini-2.5-flash` | `thinkingConfig.thinkingBudget=128` |
| `gemini-2.5-pro-low` | `gemini-2.5-pro` | `thinkingConfig.thinkingBudget=2048` |

由 `transform/reasoning_effort.go` 中可配置规则表驱动，admin-console 可可视化编辑（次阶段，先用 YAML 默认表）。

## 4. 实施分期

| 阶段 | 周期感 | 交付物 | 前置 |
|---|---|---|---|
| **P0 Claude 出入站** | 1.5 周 | `inbound/claude.go` + `outbound/claude.go` + `adaptor/claude.go`（出站 Claude 上游） | Channel/Relay plan |
| **P1 Gemini 出入站** | 1.5 周 | `inbound/gemini.go` + `outbound/gemini.go` + `adaptor/gemini.go` | P0（共享 transform） |
| **P2 Reasoning Effort + Thinking** | 1 周 | `transform/reasoning_effort.go` + `transform/thinking.go` + 配置默认表 | P0 |
| **P3 OpenAI Responses 最小集** | 1 周 | `inbound/responses.go` + `outbound/responses.go`（不含 `previous_response_id`） | P0 |
| **P4 错误码映射 + 审计字段** | 0.5 周 | `adaptor/errors_map.go` + Blake2b 链兼容 | P0 |
| **P5 SDK 互通 + 性能回归** | 1 周 | 三 SDK 互通自动化、TTFT 回归脚本、`docs/runbooks/multi-protocol.md` | 全 |

总周期 ~6.5 周。与 MCP plan、Cache plan 并行无文件冲突。

## 5. 测试与验证

- **官方 SDK 互通**（关键，避免协议精度自欺）：
  - `tests/sdk_compat/anthropic_test.py`（含 stream / tools / 多轮）
  - `tests/sdk_compat/gemini_test.py`
  - `tests/sdk_compat/openai_test.py`（含 Responses 最小集）
- **单测**：`transform/*_test.go` 覆盖每个转换函数 ≥ 6 case；`inbound/*_test.go` 覆盖 happy + malformed JSON + 缺字段
- **集成**：`relay/multi_protocol_integration_test.go` 3×3 矩阵
- **性能**：`scripts/perf-protocol-translate.sh`
- **审计链校验**：`verify-audit-chain.sh` 含跨协议事件

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| Anthropic / Gemini 协议更新破坏兼容 | 隔离 wire format 到 `inbound/outbound` 包，pivot 不变；按官方 changelog 月度对齐 |
| Tool/function 语义在三家不一致 | `transform/tools_mapping.go` 维护映射表 + 显式告知客户不支持的细粒度场景 |
| Thinking 模型上游收敛慢导致 SSE 卡顿被误判 idle | `stream_idle_timeout` 与思考类调用解耦：上游声明 thinking-enabled 时放宽至 180s |
| Responses 多轮 `previous_response_id` 客户期望落空 | 文档明确"当期仅最小集"，admin-console 模型管理标 `responses_full=false` |
| 跨协议转换隐藏 bug 影响审计完整性 | 关键字段必经 `transform_test.go` round-trip 校验 |

**回退**：每个入站协议独立 env 开关（`GATEWAY_INBOUND_CLAUDE=on` / `_GEMINI=on` / `_RESPONSES=on`），任一关闭即不挂载对应 handler。

## 7. 与 new-api 对照

| new-api 能力 | 本 plan |
|---|---|
| Claude Messages 入站 | ✅ FR-1 |
| Gemini generateContent 入站 | ✅ FR-2 |
| OpenAI Responses 入站 | ✅ FR-3（最小集） |
| OpenAI ⇄ Claude 双向 | ✅ FR-4 |
| OpenAI → Gemini | ✅ FR-4 |
| Gemini → OpenAI | ✅ FR-4（文本 + 标注 best-effort） |
| Reasoning effort 模型派生 | ✅ FR-5 |
| Thinking-to-content | ✅ FR-6 |
| Realtime API（WebSocket） | ❌ 单独 plan |
| Image / Audio / Video / Rerank | ❌ 单独 plan |
| Midjourney / Suno / Dify | ❌ 不在路线图 |

## 8. 文档与归档

- `enterprise/docs/runbooks/multi-protocol.md`（运维）
- `enterprise/docs/architecture/protocol-translation.md`（设计 + pivot 选择论证）
- `docs/guides/multi-sdk-integration.md`（客户用 Anthropic / Gemini SDK 接 enterprise gateway 的步骤）
- 合规：不复制 new-api 转换代码；以 Anthropic / Google / OpenAI 官方协议文档为唯一参考

## 9. 待澄清问题

1. **Anthropic `cache_control` 块** 是当前 Plan 处理还是交给 Cache plan？建议交给 Plan 3（缓存体系一并设计）。
2. **Gemini safety settings** 命中是否走我们 policy 三通道？建议：上游返回 safety block 时映射为 `policy.upstream_safety_block`，进我们审计但不重写策略命中字段。
3. **Responses `previous_response_id` 多轮**是否在 P3 阶段做一个最小实现（PG 存映射）？倾向 P3 不做，独立 plan；先文档明确"当期不支持"。

---

**Made-with: Damon Li**
