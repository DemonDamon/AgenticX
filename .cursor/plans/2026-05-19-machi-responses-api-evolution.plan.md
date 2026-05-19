# Machi Responses API 架构演进规划

- **Plan-Id**: 2026-05-19-machi-responses-api-evolution
- **Plan-File**: `.cursor/plans/2026-05-19-machi-responses-api-evolution.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-19
- **相关上下文**:
  - 触发对话：彩讯 new-api 网关在 ≥17 个 tools / ~10KB payload 时 nginx 500
  - 行业趋势：OpenAI Responses API（`/v1/responses`）逐步成为新模型（o-系列、gpt-5、agentic SDK）默认协议
  - new-api 已在 [Chat](../../docs/thrdparty/newapi-chat接口.md) 和 [补全](../../docs/thrdparty/newapi-补全接口.md) 文档中同时暴露 `/v1/chat/completions`、`/v1/responses`、`/v1/messages` 三种入口

---

## 1. 背景与问题

### 1.1 现状

Machi 全链路只走 **OpenAI Chat Completions**：

| 层 | 实际入口 |
|----|----------|
| `agenticx/llms/litellm_provider.py` | `litellm.completion / acompletion`（`/v1/chat/completions`） |
| `agenticx/llms/kimi_provider.py` | `openai.OpenAI().chat.completions.create` |
| `agenticx/runtime/agent_runtime.py` | `messages[]` + `tool_calls` 语义 |
| `agenticx/server/openai_protocol.py` | 仅 `handle_chat_completion` |
| Desktop / 分身 / 群聊 / Automation | 全部基于 `chat/completions` |

仓库内 **无任何** `/v1/responses` 生产调用路径。

### 1.2 触发动机（按重要性排）

1. **行业协议迁移**
   - OpenAI o-系列、gpt-5 family 把 `reasoning`、`previous_response_id`、服务端 MCP/Shell/Web Search 工具放到 Responses 原生支持
   - Cursor、Codex、AI SDK v5 等客户端已切换 Responses 为默认
   - Anthropic `/v1/messages`、Gemini `/v1beta` 也是「结构化输出 + 多模态 + reasoning」的同类形态，Responses 是 OpenAI 侧对齐

2. **多轮上下文成本**
   - 现状每轮都把完整 `messages[]`（含历史 tool_calls / tool_results）回传，token 成本随轮次线性涨
   - Responses 的 `previous_response_id` 让网关侧保留上下文，请求体可以只发增量 input

3. **推理透传一致性**
   - Chat 下 `reasoning_content` 各家字段不统一（kimi、deepseek、glm 都有差异）
   - Responses 的 `reasoning` object（带 `summary`、`encrypted_content`）有规范结构，便于 ReasoningBlock 渲染与持久化

4. **服务端 Hosted Tools**
   - Responses 原生支持 OpenAI hosted `web_search_preview`、`file_search`、`computer_use_preview`、`code_interpreter`
   - 若使用，可减少 Machi 自带 tools 的 schema 体积（与「彩讯网关 ~10KB 限额」也有边际帮助，但不是主要解法）

### 1.3 非目标（写清楚避免范围爆炸）

- **不解决「彩讯 new-api 网关 tools payload 过大 500」** —— 那是 [compact_tools 任务](compact_tools_per_provider_TBD.plan.md) 的目标，与本规划独立推进
- **不替换** Chat Completions：Machi 长期保留 Chat 作为默认通道
- **不强迫** 国内厂商（kimi 官方、彩讯、bailian、ark、qianfan、minimax）支持 Responses；这些 provider 维持 Chat
- **不引入** OpenAI Assistants API 旧形态（Threads / Runs / Assistants）—— 已被 Responses 取代

---

## 2. 设计目标与原则

### 2.1 目标（FR）

- **FR-1**：Machi 同时支持 Chat 与 Responses 两条 LLM 调用路径，**按 provider 配置选择**，默认 Chat
- **FR-2**：Responses 路径必须支持 Agent Runtime 现有能力：tools / tool_calls / streaming / 推理透传 / usage 累计 / interrupt
- **FR-3**：`previous_response_id` 在同一 Studio session 内可选启用，命中时只发增量 input
- **FR-4**：Desktop「模型服务」设置里，OpenAI 兼容 provider 可选「API 形态：Chat / Responses」，持久化到 `~/.agenticx/config.yaml`
- **FR-5**：ReasoningBlock 在 Responses 推理块（`reasoning.summary[].text` 流）上渲染效果不低于 Chat 现有体验

### 2.2 非功能（NFR）

- **NFR-1**：Responses 通路不破坏任何现有 Chat 通路；切换是 opt-in 的 provider 字段
- **NFR-2**：失败回退（Responses 调用 401/404/501 等明确不支持错误）自动降级到 Chat 同次请求，记录一次降级日志
- **NFR-3**：所有持久化（messages.json、SQLite usage、session_messages_fts）保持 Chat schema 为正本；Responses 路径写入前归一化
- **NFR-4**：单测 + 冒烟测试覆盖：Responses streaming、tool_call、reasoning、previous_response_id 续接、降级 Chat

### 2.3 设计原则

- **正本是 Chat**：内部数据模型继续按 `messages + tool_calls` 存储；Responses 仅是「出口适配器」
- **按 provider 切换，不是按 model**：避免在 `ProviderResolver` 里堆模型黑白名单
- **降级优先于报错**：用户感受不到协议差异，只感知到能不能工作

---

## 3. 现状分析（关键代码点）

### 3.1 入口点

```
agenticx/llms/litellm_provider.py:47   litellm.completion(...)        # 同步
agenticx/llms/litellm_provider.py:79   litellm.acompletion(...)        # 异步
agenticx/llms/litellm_provider.py:109  litellm.completion(stream=True) # 流式
agenticx/llms/litellm_provider.py:175  stream_with_tools (tool 流式)
agenticx/llms/litellm_provider.py:269  _astream_generator
```

LiteLLM 已经原生暴露 `litellm.responses(...)` / `litellm.aresponses(...)`，无需替换库。

### 3.2 Agent Runtime 集成点

```
agenticx/runtime/agent_runtime.py:1141  stream_with_tools = getattr(self.llm, "stream_with_tools", None)
agenticx/runtime/agent_runtime.py:1167  for chunk in stream_with_tools(messages_for_llm, **stream_kwargs)
agenticx/runtime/agent_runtime.py:1396  llm.invoke / llm.ainvoke fallback path
```

Runtime 只看 provider 是否实现 `stream_with_tools`，对底层协议无感知 —— 利于扩展。

### 3.3 持久化

```
agenticx/studio/session_manager.py     messages.json: chat_history 仍按 {role, content, tool_calls, tool_call_id}
agenticx/memory/session_store.py       session_messages FTS 也按 chat schema
```

Responses 不能改变这层结构，必须在 provider 适配层完成 `output[]` → `chat message + tool_calls` 的归一化。

### 3.4 现有 provider 路由

```
agenticx/llms/provider_resolver.py:27   PROVIDER_MAP
agenticx/llms/provider_resolver.py:75   custom OpenAI-compatible gateway 走 LiteLLMProvider
```

`ProviderConfig` 已有 `drop_params` / `extra` / `interface` 字段，新增 `api_format` 字段即可不破坏老配置。

---

## 4. 范围（FR / NFR / AC）

### 4.1 功能需求 FR

- **FR-1**：`ProviderConfig` 新增 `api_format: Optional[Literal["chat", "responses"]]`，缺省 `"chat"`
  - 写入 `~/.agenticx/config.yaml`（`providers.<key>.api_format`）
  - Desktop 设置面板「模型服务」详情区新增下拉，仅对 OpenAI 兼容（`interface == "openai"` 或 `kimi` / `openai` provider）显示

- **FR-2**：新增 `agenticx/llms/responses_provider.py: OpenAIResponsesProvider(LiteLLMProvider)`
  - 复用 `LiteLLMProvider` 的 `api_key / base_url / drop_params / fallbacks / timeout`
  - 覆盖 `invoke / ainvoke / stream / astream / stream_with_tools` 五个方法
  - 内部走 `litellm.responses` / `litellm.aresponses` / `litellm.responses(stream=True)`

- **FR-3**：消息形态转换工具 `agenticx/llms/responses_adapter.py`
  - `chat_messages_to_responses_input(messages) -> {instructions, input}`
    - 提取首条 `system` → `instructions`
    - 其余按 `{role, content}` 列表传 `input`
    - `tool_calls` → `function_call` 输出条目；`tool` 角色 → `function_call_output` 条目
  - `responses_output_to_chat_choices(output) -> [{message, finish_reason}]`
    - `output[*].type == "message"` → `assistant.content`
    - `output[*].type == "function_call"` → `assistant.tool_calls`
    - `output[*].type == "reasoning"` → 拼装为 `<think>` 块（与 KimiProvider 现有 `_compose_content_with_reasoning` 风格一致）
  - `responses_usage_to_token_usage(usage) -> TokenUsage`
    - Responses 字段为 `prompt_tokens / completion_tokens / total_tokens`（与 Chat 同名），但 details 子结构需要对齐 `completion_tokens_details.reasoning_tokens`

- **FR-4**：流式归一化
  - Responses streaming event 类型至少处理：
    - `response.created` → 忽略
    - `response.output_text.delta` → `{"type": "content", "text": delta}`
    - `response.reasoning.delta` / `response.reasoning_summary.delta` → 包裹 `<think>` 块输出
    - `response.function_call_arguments.delta` → `{"type": "tool_call_delta", ...}`
    - `response.completed` → 收尾 `{"type": "done", "finish_reason": ...}`，附带最终 usage `{"type": "usage", "usage": {...}}`
  - 输出格式与 `litellm_provider.stream_with_tools` 完全一致，Runtime 零改

- **FR-5**：`previous_response_id` 会话续接
  - `StudioSession` 新增 `last_response_id: Optional[str]`，写入 `~/.agenticx/sessions/<id>/state.json`
  - 启用条件（全部满足）：
    - provider `api_format == "responses"`
    - `~/.agenticx/config.yaml` 全局开关 `runtime.responses_chain_enabled: true`（默认 false，灰度）
    - 同一 session 上一轮成功调用 Responses 且拿到 `id`
  - 命中时：只发 `input = [新增 user 消息 + 新增 context_files]`，省略历史；附 `previous_response_id`
  - 工具结果回写：把当前 tool 结果作为新的 `function_call_output` input 发出，配合 `previous_response_id` 继续

- **FR-6**：降级
  - 若 Responses 调用抛出 `litellm.NotFoundError` / `BadRequestError` 且 message 含 `responses` 关键词 / `404`：自动用同一 `messages` 重新走 Chat 一次
  - 每个 session 记一次警告事件 `event=responses_fallback_chat`，并在 Studio API 暴露给 Desktop（小红点提示「该 provider 不支持 Responses，已自动回落 Chat」）

- **FR-7**：Desktop 设置 UX
  - 「模型服务 → 详情 → 高级参数」新增「API 形态」下拉：Chat（默认）/ Responses（实验）
  - 旁边提示文案：「Responses 为 OpenAI 新一代协议，可减少 token 重复传输；国内代理网关不一定支持，失败时自动回落 Chat。」
  - 选 Responses 后联动展示 `runtime.responses_chain_enabled` 开关（仅当全局未启用时显示「开启会话续接（previous_response_id）」一键开启）

### 4.2 非功能 NFR

- **NFR-1**：现有 Chat 全链路单测 100% 不受影响（CI 红线）
- **NFR-2**：Responses 适配层独立模块，主 Runtime / Persistence / UI 零侵入或最小侵入
- **NFR-3**：所有写入 `messages.json` / SQLite 的数据保持 Chat 结构正本
- **NFR-4**：Responses 路径增加的额外延迟 ≤50ms / 轮（仅适配层开销）
- **NFR-5**：失败回退一次 Chat 必须保证用户感知不到协议切换；UI 仅在设置页给一次性提示

### 4.3 验收 AC

- **AC-1**：在配置 `kimi` provider `api_format=responses` 后，Meta-Agent「你好」请求经 LiteLLM 走 `POST /v1/responses`，且回复正常流式渲染
- **AC-2**：同一 session 连发 3 轮，第 2/3 轮 payload 中包含 `previous_response_id` 字段，不再重复历史 messages
- **AC-3**：tool_calls 完整链路工作：模型发出 `function_call`、Runtime 执行、结果通过 `function_call_output` 续接，最终得到正确回复
- **AC-4**：ReasoningBlock 在 Responses 推理流上从「Thinking → Thought for X seconds」收尾，行为与 Chat 一致
- **AC-5**：把 `api_format=responses` 配到一个上游不支持 Responses 的 base_url，自动回落 Chat 并在设置页显示「已回落 Chat」状态
- **AC-6**：彩讯 new-api 后台若开了 Responses 渠道（kimi-k2.6），Machi 该 provider 切到 Responses 后能通；若没开则自动回落 Chat
- **AC-7**：冒烟测试覆盖：`tests/test_smoke_responses_provider_streaming.py`、`tests/test_smoke_responses_previous_response_id.py`、`tests/test_smoke_responses_fallback_chat.py`

---

## 5. 分阶段实施

### Phase 0 —— 调研与样例验证（半天，不动主仓代码）

- 用 `litellm.responses(model="openai/gpt-4o-mini", input="hi", stream=True)` 跑通一份本地脚本
- 用 `litellm.responses(model="openai/kimi-k2.6", api_base="https://api.moonshot.cn/v1", ...)` 验证 Moonshot 是否支持（很大概率不支持，期望走 OpenAI 官方）
- 用同样脚本打彩讯 new-api，确认网关行为（200 / 404 / 500）
- **产出**：`research/responses-api/` 下 3 份 curl + JSON sample，写入本 plan 附录

### Phase 1 —— 适配器与 Provider 类（2~3 天）

- 新建 `agenticx/llms/responses_adapter.py`：消息 / 流式事件 / usage 双向转换函数 + 单测
- 新建 `agenticx/llms/responses_provider.py`：继承 `LiteLLMProvider`，覆写 5 个 IO 方法
- `agenticx/cli/config_manager.py`：`ProviderConfig` 加 `api_format` 字段
- `agenticx/llms/provider_resolver.py`：当 `provider.api_format == "responses"` 且 provider 走 LiteLLM 路径时，返回 `OpenAIResponsesProvider`
- 单测：
  - `tests/test_responses_adapter_messages.py`
  - `tests/test_responses_adapter_stream.py`
  - `tests/test_responses_provider_invoke.py`（mock litellm.responses）
- **退出准则**：单测全绿；不接 Runtime / UI

### Phase 2 —— Runtime 接线 + 降级（2 天）

- `agent_runtime.py` 流式路径无需改（依赖 `stream_with_tools` 协议契约）
- 新增 `runtime/responses_fallback.py`：捕获 Responses 调用错误 → 重建 Chat 调用、记日志事件
- `studio/server.py`：把 `responses_fallback` 事件转 SSE 给 Desktop
- 冒烟测试：
  - `tests/test_smoke_responses_provider_streaming.py`：mock LLM 端，跑一次 Meta-Agent 单聊
  - `tests/test_smoke_responses_fallback_chat.py`：上游强制 404，验证回落
- **退出准则**：本机配置 OpenAI 官方 + `api_format=responses` 后，Meta 单聊正常

### Phase 3 —— previous_response_id（2 天）

- `StudioSession.last_response_id` + 持久化
- `agent_runtime.py` 流式接收 `response.completed` 后回写 `last_response_id` 到 session
- `OpenAIResponsesProvider` 在 `stream_with_tools` 里读 `session_context.last_response_id`，命中则裁剪 input
- 配置开关 `runtime.responses_chain_enabled`
- 冒烟测试：`tests/test_smoke_responses_previous_response_id.py`
- **退出准则**：连续 3 轮请求体显著缩小（第 2/3 轮 ≤30% 第 1 轮的 messages 体量）

### Phase 4 —— Desktop UX（1 天）

- 「模型服务 → 详情」加 `API 形态` 下拉
- 「设置 → Runtime」加 `runtime.responses_chain_enabled` 开关
- 顶栏 / 设置页提示「该 provider 已自动回落 Chat」（消费 Phase 2 的 SSE 事件）
- E2E 手测：OpenAI / kimi 官方 / 彩讯 三种 provider 各切一次

### Phase 5 —— 文档与发布（0.5 天）

- `docs/guides/responses-api.md`：用户文档，说明何时该用、风险与回退
- README / `CHANGELOG` 加一条 feat
- 标注为 **实验特性**，默认关闭，灰度推

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| LiteLLM Responses 适配不稳定（streaming event 字段变化） | 中 | 高 | 适配层抽象事件枚举；CI 锁 LiteLLM 版本 |
| 国内代理网关不支持 / 转换异常 | 高 | 中 | 默认 Chat；显式 opt-in；自动回落 Chat |
| `previous_response_id` 命中率低（网关侧不存上下文） | 高 | 低 | 全局开关默认 false；命中失败时同一次请求自动重发为「不带 previous_response_id」 |
| ReasoningBlock 渲染差异（reasoning summary 多行 vs 单流） | 中 | 中 | 适配层把多条 summary text 合并；按 `event=response.reasoning.delta` 控制起止 |
| 已有 messages.json / FTS 不兼容 Responses output 类型 | 低 | 高 | 适配层强制归一化为 chat schema；禁止 Responses 结构外泄 |
| 工具数量 53 个仍超彩讯网关阈值（Responses 也带 tools 字段） | 高 | 中 | **本规划不解决**；compact_tools 单独立项 |
| 多 provider 同时开启 Responses + chain 时的 last_response_id 串台 | 低 | 中 | `last_response_id` 按 `(session_id, provider, model)` 三元组持久化 |

---

## 7. 与 compact_tools 的关系

| 维度 | 本规划（Responses） | compact_tools |
|------|---------------------|---------------|
| 目标 | 协议演进、长期架构对齐 | 解决彩讯网关 ~10KB 上限 |
| 紧迫性 | 中（行业趋势） | 高（用户当前阻塞） |
| 工期 | ~8 人日 | ~1 人日 |
| 是否互斥 | 否 | 否 |
| 推进顺序 | 后做（Phase 0 可与 compact_tools 并行） | 先做（救火） |

**建议**：compact_tools 先落地解燃眉之急；Responses 演进按本 plan 节奏推。

---

## 8. 验证与回归

### 8.1 必跑测试

- `pytest tests/test_responses_adapter_messages.py`
- `pytest tests/test_responses_adapter_stream.py`
- `pytest tests/test_responses_provider_invoke.py`
- `pytest tests/test_smoke_responses_provider_streaming.py`
- `pytest tests/test_smoke_responses_previous_response_id.py`
- `pytest tests/test_smoke_responses_fallback_chat.py`
- 现有全量冒烟：`pytest tests/test_smoke_*` 必须不退化

### 8.2 手测矩阵

| Provider | api_format | 期望 |
|----------|-----------|------|
| OpenAI 官方 (gpt-4o-mini) | responses | ✅ 直通 |
| OpenAI 官方 (gpt-4o-mini) | chat | ✅ 直通（兼容老路径） |
| kimi 官方 (kimi-k2.6) | responses | ⚠️ 自动回落 Chat（Moonshot 暂未提供 Responses） |
| 彩讯 (kimi-k2.6) | responses | 取决于网关；不支持时回落 Chat |
| 彩讯 (kimi-k2.6) | chat | 现有行为（仍受 compact_tools 影响） |
| Anthropic / Gemini | n/a | 不暴露 api_format 选项 |

### 8.3 监控

- Studio 暴露 `/api/runtime/stats` 计数器：`responses_calls_total / responses_fallback_total / responses_chain_hit_total`
- Desktop 设置页底部小字展示「Responses 调用：X 次，自动回落：Y 次」（仅当全局开了 Responses 时显示）

---

## 9. 提交与 Plan-Id

- 所有相关 commit 使用 `/commit --spec=.cursor/plans/2026-05-19-machi-responses-api-evolution.plan.md` 自动注入：
  ```
  Plan-Id: 2026-05-19-machi-responses-api-evolution
  Plan-File: .cursor/plans/2026-05-19-machi-responses-api-evolution.plan.md
  Made-with: Damon Li
  ```
- 每个 Phase 落一组独立 commit，便于回滚

---

## 10. 附录

### 10.1 Responses vs Chat 关键字段对照

| 维度 | Chat Completions | Responses |
|------|------------------|-----------|
| 端点 | `POST /v1/chat/completions` | `POST /v1/responses` |
| 输入 | `messages: [{role, content, tool_calls, tool_call_id}]` | `instructions: string` + `input: string \| array` |
| 系统提示 | `messages[0]` role=system | 顶层 `instructions` |
| 工具调用 | `tool_calls[].function.{name, arguments}` | `output[].type=="function_call"` |
| 工具结果 | `messages` role=tool, `tool_call_id` | `input[].type=="function_call_output"` |
| 推理 | `message.reasoning_content`（非标准） | `output[].type=="reasoning"` + `response.reasoning.delta` 事件 |
| 多轮续接 | 每次回传完整 messages | `previous_response_id` 引用上一次响应 |
| 流式事件 | `delta.content / delta.tool_calls / finish_reason` | `response.output_text.delta / response.function_call_arguments.delta / response.completed` |
| usage 字段名 | `prompt_tokens / completion_tokens / total_tokens` | 与 Chat 同名（new-api 文档已对齐） |

### 10.2 LiteLLM 调用样例（Phase 0 验证脚本）

```python
import litellm

# 1) 同步
r = litellm.responses(
    model="openai/gpt-4o-mini",
    input="你好",
    instructions="You are Machi.",
    tools=[{"type": "function", "name": "bash_exec", "description": "...", "parameters": {...}}],
)
print(r.output)

# 2) 流式
for chunk in litellm.responses(
    model="openai/gpt-4o-mini",
    input="写一首七言绝句",
    stream=True,
):
    print(chunk)

# 3) previous_response_id 续接
r2 = litellm.responses(
    model="openai/gpt-4o-mini",
    input="再来一首",
    previous_response_id=r.id,
)
```

### 10.3 new-api 文档锚点

- Chat：`docs/thrdparty/newapi-chat接口.md` §`ChatCompletions格式`
- Responses：`docs/thrdparty/newapi-chat接口.md` §`Responses格式`
- 旧 Completions（不在本规划范围）：`docs/thrdparty/newapi-补全接口.md`

---

**审阅清单（Owner Review）**：

- [ ] 范围是否合理（不混入 compact_tools）
- [ ] Phase 切分是否可独立验收
- [ ] 默认值是否安全（默认 Chat、灰度 Responses）
- [ ] 是否准备好回退路径（Fallback to Chat）
- [ ] 是否对齐项目惯例（Plan-Id / Made-with / 中文文档）
