# AgenticX LLM 模块（agenticx/llms）完整结构分析

> 结论更新时间：2026-05-29（覆盖 2026-04-14 之后的变更）

## 目录路径
`d:\myWorks\AgenticX\agenticx\llms`

## 完整目录结构和文件摘要
```
├── __init__.py
├── ark_provider.py          [火山引擎 Ark / Doubao 模型 Provider]
├── auth_profile.py          [新增：Auth Profile 轮换与冷却持久化（参考 OpenClaw）]
├── bailian_provider.py      [阿里云百炼 Provider]
├── base.py                  [增强：invoke_with_profile / supports_auth_profile_rotation]
├── failover.py              [新增：LLM 主备故障转移与冷却（内化自 IronClaw）]
├── kimi_provider.py
├── litellm_provider.py
├── llm_factory.py           [Provider 工厂 / 路由]
├── minimax_provider.py      [MiniMax OpenAI 兼容 Provider]
├── provider_resolver.py     [增强：旧版 custom_openai 兼容与模型前缀归一化]
├── qianfan_provider.py      [百度千帆 Provider]
├── response.py
├── response_cache.py        [新增：in-memory TTL+LRU 响应缓存（内化自 IronClaw）]
├── transcript_sanitizer.py  [新增：Provider 感知的 Transcript 卫生管线（参考 OpenClaw）]
├── vision.py                [(NEW) 视觉能力推断：按 provider/model 判断是否接受 image_url 输入]
└── zhipu_provider.py        [智谱 GLM Provider]
```

### __init__.py
**文件功能**：作为 LLM 子模块的入口，统一导出核心基类、数据结构与多种 Provider 适配类，方便外部按模型名称快速实例化。  
**技术实现**：通过 `from .xxx import xxx` 聚合导入，随后在 `__all__` 中显式暴露公开 API；**新增对 LiteLLM 等依赖的 lazy import 支持，增强在受限沙箱环境下的加载兼容性**。  
**关键组件**：`OpenAIProvider`、`AnthropicProvider`、`OllamaProvider`、`GeminiProvider`、`MoonshotProvider` 五个快捷类。  
**业务逻辑**：为上层业务提供“按名称即用”的 LLM Provider，隐藏底层实现差异。  
**依赖关系**：依赖本目录内 `base.py`、`response.py`、`litellm_provider.py`、`kimi_provider.py`。

### auth_profile.py (新增，内化自 OpenClaw)
**文件功能**：实现 API Key 轮换管理，支持多 Profile 冷却退避与状态持久化。  
**技术实现**：基于 `dataclass` 定义 Profile 和冷却状态，支持 JSON 文件持久化和原子写入。  
**关键组件**：
- `AuthProfileCooldown` 数据类：冷却状态，包含 `cooldown_until`、`disabled_until`、`error_count`、`failure_type`
- `AuthProfile` 数据类：单个认证配置，包含 `name`、`provider`、`api_key`、`profile_type`、`last_used`、`cooldown`；`is_available` 属性判断当前时间是否超过冷却期
- `AuthProfileManager` 类：核心轮换管理器
  - `get_current()`：返回可用且最久未使用的 Profile
  - `mark_success(profile_name)`：重置错误计数和冷却时间
  - `mark_failure(profile_name, failure_type)`：按指数退避计算冷却时间
  - `advance(exclude_name)`：手动切换到下一个可用 Profile
  - `classify_failure(error)`：从异常消息中识别错误类型（`billing` / `auth` / `rate_limit` / `other`）
  - 冷却策略：rate_limit 基础 60s、上限 1h（5x 退避）；billing 基础 5h、上限 24h（2x 退避）
  - `_persist()` / `_load_persisted_state()`：通过 `tmp + rename` 原子写入实现状态持久化
**业务逻辑**：在多 API Key 场景下，当某个 Key 触发限流或配额耗尽时自动切换到下一个，并按错误类型设置差异化的冷却退避。  
**依赖关系**：被 `agenticx.core.agent_executor.AgentExecutor` 集成使用。

### base.py (增强版)
**文件功能**：定义所有 LLM Provider 的抽象基类 `BaseLLMProvider`，统一同步 / 异步调用与流式接口签名。  
**技术实现**：继承 `ABC` 与 `pydantic.BaseModel`，并使用 `@abstractmethod` 定义 `invoke / ainvoke / stream / astream`; 字段 `model` 通过 `Field` 声明。  
**关键组件**：类 `BaseLLMProvider`、类型 `LLMResponse`（引用）。  
**新增方法（参考 OpenClaw）**：
- `supports_auth_profile_rotation()`：返回 `True`，表明该 Provider 支持接收外部轮换的凭据
- `invoke_with_profile(prompt, api_key, **kwargs)`：使用指定 `api_key` 调用 LLM，默认实现委托给 `invoke()`，子类可覆写以实现更精细的凭据注入
**业务逻辑**：约束所有具体 Provider 的功能一致性，使框架可在运行时自由切换后端模型；**新增的 Profile 接口使 AgentExecutor 可在不修改 Provider 实例的情况下切换 API Key**。  
**依赖关系**：依赖 `pydantic`, `typing`, 本目录 `response.LLMResponse`。

### kimi_provider.py
**文件功能**：实现 Moonshot AI Kimi 模型 Provider `KimiProvider`，封装同步 / 异步 / 流式三种调用及结果解析。  
**技术实现**：
1. 构造函数创建 `openai.OpenAI` 兼容客户端；
2. `invoke/ainvoke` 组装 `messages`、`tools` 调用 `chat.completions.create`；
3. `_parse_response` 将 OpenAI 风格响应转换为内部 `LLMResponse`，包含 token 统计、choice 列表与元数据；
4. `generate` 提供简单 prompt→文本 快捷方法；
5. `from_config` 支持字典化配置实例化。  
**关键组件**：类 `KimiProvider`、私有方法 `_parse_response`。  
**业务逻辑**：让框架能够无缝接入 Moonshot 的 Kimi-K2 系列模型，并保持 OpenAI 兼容接口。  
**依赖关系**：外部库 `openai`; 内部基类 `BaseLLMProvider`、数据结构 `LLMResponse`。  
**本次更新（2026-04-14 之后）**：
- **(NEW) Kimi K2.6 推理与流式适配**：`kimi-k2.5/k2.6` 开启 thinking 时强制 `temperature=1.0`、关闭时回落 `0.6`；将上游 `reasoning_content` 映射为 `redacted_thinking` 供 Desktop ReasoningBlock 渲染；新增 `stream_with_tools` 以支撑 AgentRuntime 流式工具调用路径（commit `95e2adda`）。
- **(NEW) 空 assistant 行清洗**：在请求准备阶段丢弃 content 为空且无 tool_calls 的 assistant 历史行，仅当 tool_calls 需要非空 content 时填入单空格占位，规避 Moonshot 对引用转发等场景返回 HTTP 400（commit `62991535`）。

### litellm_provider.py
**文件功能**：实现基于第三方库 `litellm` 的通用 Provider `LiteLLMProvider`，可同时支持 OpenAI、Anthropic、Ollama 等多后端。  
**技术实现**：
1. 使用 `litellm.completion / acompletion` 执行请求；
2. 支持同步 / 异步 / 流式接口；
3. `_parse_response` 兼容 `usage` 既可能为对象也可能为 dict 的情况，安全提取 token 使用与 cost；
4. `generate` 与 `from_config` 提供辅助方法；
5. **新增 `fallbacks` 字段和支持（P1-3）**：支持主模型失败时自动回退到备选模型列表，提升系统稳健性。
**关键组件**：类 `LiteLLMProvider`、方法 `_parse_response`。  
**业务逻辑**：为多云/多模型场景提供统一适配层，大幅降低接入不同 LLM API 的成本。**新增模型回退机制，当主模型失败时自动切换到备选模型，无需上层应用感知，提升可用性**。  
**依赖关系**：外部库 `litellm`; 内部 `BaseLLMProvider`、`LLMResponse`。

### minimax_provider.py
**文件功能**：实现 MiniMax 模型 Provider `MiniMaxProvider`，继承 `LiteLLMProvider`，通过 OpenAI 兼容端点接入 MiniMax API。
**技术实现**：
1. 继承 `LiteLLMProvider`，复用 LiteLLM 的完整调用链路；
2. Pydantic `@model_validator(mode="after")` 自动标准化配置：当模型名不含 `/` 时自动补 `openai/` 前缀（如 `MiniMax-M2.5` -> `openai/MiniMax-M2.5`），确保 LiteLLM 正确识别 provider；`base_url` 默认 `https://api.minimax.chat/v1`；
3. `from_config` 默认模型 `MiniMax-M2.5`。
**关键组件**：类 `MiniMaxProvider`、字段 `group_id`（可选，MiniMax account-scoped routes）。
**依赖关系**：继承 `LiteLLMProvider`；被 `provider_resolver.py` 路由使用。

### provider_resolver.py（增强）
**文件功能**：将 `~/.agenticx/config.yaml` 中 Provider 配置解析为具体 Provider 实例，并在解析阶段做兼容路由与模型名归一化。  
**技术实现（本次关键更新）**：
1. 新增 `_is_legacy_custom_openai_provider()`：针对旧版 Desktop 创建、缺少 `extra.interface` 字段的 `custom_openai_*` Provider，若同时具备 `base_url` 与 `api_key`，则按 OpenAI 兼容网关处理；
2. `resolve()` 在 `provider_key` 不在 `PROVIDER_MAP` 时新增回退逻辑：`extra.interface == "openai"` 或命中旧版兼容判定时，统一路由到 `LiteLLMProvider`，并将 `effective_key` 设为 `openai`；否则仍抛出 `Unsupported provider`；
3. `_normalized_model()` 新增 `base_url` 参与判断：当 `effective_key == "openai"` 且存在 `base_url` 时，若模型名不含 `/`（如 `deepseek-r1`），自动补 `openai/` 前缀，避免 LiteLLM 在网关场景下因裸模型名路由失败；
4. `_build_kwargs()` 透传 `base_url` 到归一化流程，保证模型名前缀策略与网关配置一致。  
**关键价值**：修复“健康检查可用但聊天时报 Unsupported provider / BadRequestError”的兼容问题，保障旧配置与自定义 OpenAI 网关模型在聊天链路中的可用性。  

### vision.py (NEW，2026-05-26 随 web_fetch/view_image 引入)
**文件功能**：集中判断「某 provider/model 组合是否应接受图片（`image_url`）输入」，供 Studio/Desktop 在注入视觉附件前做统一守卫。  
**技术实现**：纯函数模块（无外部依赖），核心 `is_vision_capable(provider_name, model_name) -> bool`；内置两条厂商规则：
- `_minimax_m2_family_no_vision()`：MiniMax M2 chat 系列（`minimax-m2*`、`m2.x` 等，名称不含 `vl`/`vision`）按非视觉处理
- `_zhipu_glm5_family_no_vision()`：智谱 `glm-5` / `glm-5-*`（不含 `vl`/`vision`/`4v`/`5v`）按非视觉处理
**业务逻辑**：是 `view_image` / 附图链路的前置闸门——对不支持多模态的模型剥离 `image_inputs`，避免上游因 image part 报错；与 Desktop `model-vision.ts` 的前端拦截一一对应。  
**依赖关系**：被 runtime 视觉附件注入与 `agent_tools.view_image` 守卫调用。

### response.py
**文件功能**：定义 LLM 调用返回值标准数据结构，包括 token 用量、候选结果与元数据。  
**技术实现**：使用 `pydantic` 定义 `TokenUsage`、`LLMChoice`, `LLMResponse` 三个模型；字段含义与 OpenAI API 对齐。  
**关键组件**：`TokenUsage`, `LLMChoice`, `LLMResponse`。  
**业务逻辑**：在框架内部提供统一结果格式，方便后续统计、计费及业务处理。  
**依赖关系**：无外部依赖本目录内其他文件，但被多 Provider 引用。

### transcript_sanitizer.py (新增，内化自 OpenClaw)
**文件功能**：实现 Provider 感知的 Transcript 卫生管线，在 LLM 调用前对 messages 列表做最小必要清洗。  
**技术实现**：基于 `TranscriptPolicy` 按 provider 名称选择策略，支持正则表达式匹配的拒绝触发词剥离。  
**关键组件**：
- `TranscriptPolicy` 数据类：每个 provider 的清洗策略配置
  - `enforce_turn_alternation`：强制 user/assistant 交替（Anthropic、Google 需要）
  - `merge_consecutive_user_turns`：合并连续 user 消息（Anthropic 需要）
  - `sanitize_tool_schema`：清洗工具 schema（Google 需要）
  - `strip_refusal_triggers`：剥离拒绝触发词（Anthropic 需要）
- `PROVIDER_POLICIES` 字典：内置 `anthropic`、`google`、`openai`、`ollama` 四种策略
- `TranscriptSanitizer` 类：核心卫生管线
  - `REFUSAL_PATTERNS`：编译好的正则列表（`do not answer`、`refuse`、`policy violation`）
  - `sanitize(messages, provider)`：按策略顺序执行清洗操作
  - `_resolve_policy(provider)`：根据 provider 名称或模型名称前缀匹配策略
  - `_enforce_alternation(messages)`：插入占位 assistant 消息确保交替
  - `_merge_consecutive_user(messages)`：合并连续 user 消息
  - `_strip_refusal(messages)`：删除匹配拒绝模式的 user 消息
**业务逻辑**：不同 LLM Provider 对消息格式有不同要求（如 Anthropic 严格要求 user/assistant 交替），此管线在调用前自动适配，避免因格式不合规导致的 API 错误。  
**依赖关系**：被 `agenticx.core.agent_executor.AgentExecutor` 集成使用。

---

## 模块整体评价
LLM 子模块通过抽象基类 + 多 Provider 设计，使 AgenticX 能够灵活接入不同云厂商或本地模型，同时保持一致的调用与结果格式。`pydantic` 数据模型确保类型安全，而流式接口支持实时增量输出，满足聊天及生成场景需求。

**VeADK 内化**：
- **Model Fallback 支持（P1-3）**：在 `LiteLLMProvider` 中新增 `fallbacks: Optional[List[str]]` 字段，支持主模型失败时自动回退到备选模型列表。所有调用方法（`invoke`、`ainvoke`、`stream`、`astream`）都会将 `fallbacks` 参数传递给 `litellm.completion` 调用，实现透明的模型回退机制，提升系统可用性

**OpenClaw 内化**：
- **Auth Profile 轮换（P0-2）**：`auth_profile.py` 新增 `AuthProfileManager`，管理多 API Key 的轮换和冷却退避，支持 JSON 持久化；`base.py` 新增 `invoke_with_profile()` 和 `supports_auth_profile_rotation()` 方法，使 Provider 可接收外部注入的凭据
- **Transcript 卫生管线（P0-3）**：`transcript_sanitizer.py` 新增 `TranscriptSanitizer`，按 provider 策略（Anthropic/Google/OpenAI/Ollama）对 messages 执行 turn 交替强制、连续消息合并、拒绝触发词剥离等清洗操作，确保不同 Provider 的消息格式合规

**IronClaw 内化**：
- **LLM 故障转移（`failover.py`）**：新增 `FailoverProvider(BaseLLMProvider)`，通过 Pydantic `PrivateAttr` 管理内部状态（`_primary`、`_fallback`、`_consecutive_failures`、`_cooldown_until`）。`invoke / ainvoke / stream / astream` 四个接口均先尝试 primary；连续失败次数达到 `failure_threshold`（默认 3）后进入 `cooldown_duration`（默认 60s）冷却，冷却期间直接路由到 fallback；primary 成功时重置失败计数。`stream()` failover 不回滚已 yield 的 partial output（已记录为已知行为）。
- **LLM 响应缓存（`response_cache.py`）**：新增 `ResponseCache`，基于 `OrderedDict` 实现 in-memory TTL+LRU 缓存。`_make_key()` 对 prompt 做 SHA-256 取前 32 hex 位作为 key；`get()` 检查时间戳超过 `_ttl` 则删除并计 miss；`put()` 写入后超过 `max_entries`（默认 100）时弹出最旧条目；`stats()` 返回 `hits`、`misses`、`size`、`hit_rate`；`invalidate()` 清空缓存但不重置统计计数。两个类均通过 `agenticx/llms/__init__.py` 导出。