# 端云协同路由：本地小模型 / 云端大模型按任务自动分流

Plan-Id: 2026-06-01-edge-cloud-collaborative-routing
Plan-File: .cursor/plans/2026-06-01-edge-cloud-collaborative-routing.plan.md

## 背景 / 动机

AI PC（NVIDIA DGX Spark / Windows Agent Native PC）正在把"本地算力"推向新量级。
经网络调研核实的事实（用于校准本 plan 的前提，避免建在错误假设上）：

- **DGX Spark**：GB10 Grace Blackwell，128GB 统一内存，但带宽仅 **273 GB/s**（比 H100 的
  3.35 TB/s 慢一个数量级），跑 DGX OS（Ubuntu Linux，**非 Windows**）。结论：它适合
  **装得下但跑得慢**——真正甜区是 7B–13B 小模型做低延迟 / 隐私 / 零 token 成本任务。
- **NVIDIA NIM on RTX**：通过 WSL2 跑容器，暴露 **OpenAI 兼容 API**（`http://localhost:8000/v1`）。
- **LM Studio**：本地推理，暴露 **OpenAI 兼容 API**（默认 `http://localhost:1234/v1`）。
- **Windows Agent Framework / Copilot Runtime**：是另一条独立生态线（Layer 2/3），本 plan **不涉及**。

Near 的差异化定位是"跨 OS / 跨模型 / 跨设备的开放 Agent 编排层"。本 plan 只落地其中
**最不依赖外部生态、且 Near 现状已接近完成**的一层：**端云协同路由（Layer 1，P0/P0.5）**。

### 已核实的代码现状（非猜测）

- `agenticx/llms/provider_resolver.py`：`PROVIDER_MAP` 已含 `ollama`（走 `LiteLLMProvider`，
  model 前缀 `ollama/`）；OpenAI 兼容自定义 provider 走 `LiteLLMProvider` + `openai/` 前缀。
  → NIM / LM Studio 均为 OpenAI 兼容，**接入只需配置层 + 极少代码**。
- `agenticx/embodiment/routing/device_cloud_router.py`：已存在 `DeviceCloudRouter`（来自 MAI-UI），
  含敏感词检测 / 复杂度 / 跨应用 / 置信度 5 条规则 + 统计。**但它是孤立组件，未接入对话主链路**，
  且依赖调用方传入 `device_provider` / `cloud_provider` 实例。
- `agenticx/studio/server.py`：`/api/chat` → `_resolve_llm()` → `ProviderResolver.resolve(provider, model)`
  解析单一 provider。当前**没有**"执行位置决策"这一层。
- `agenticx/cli/config_manager.py`：`~/.agenticx/config.yaml` 的 provider 配置单一来源。

## 目标行为

对话请求在 `_resolve_llm` 之前，经一层**执行位置决策器**，根据
**任务信号（隐私敏感 / 复杂度 / 网络可达性 / 本地后端健康度）+ 用户三态开关**
决定本轮走"本地 provider"还是"云端 provider"，并对前端透出可见的路由原因。

三态开关（对齐知识库自动检索的交互范式）：
- `cloud_only`（默认）：始终云端，行为与现状完全一致（零回归）。
- `auto`：按规则智能分流（敏感 / 简单 → 本地；复杂 / 低置信 / 本地不可用 → 云端）。
- `device_first`：尽量本地，仅在本地不可用或显式升级时回退云端。

## 范围（严格限定，遵守 no-scope-creep）

- **P0 provider 接入**：NIM / LM Studio 作为 OpenAI 兼容 provider 可配置（复用现有 LiteLLM 路径）。
- **P0.5 路由层**：新增运行时执行位置决策器（基于既有 `DeviceCloudRouter` 提升），接入
  `server.py` 的 chat 解析路径；新增 `routing:` 配置节；新增本地后端健康探测。
- **Desktop**：设置面板新增"端云协同"三态开关 + 本地 provider 选择；主聊天窗格状态区透出本轮路由原因。
- **不改**：现有 provider 解析对单一 provider 的语义、群聊 / 分身委派的 provider 回退链、
  云端默认路径（`cloud_only` 时必须与现状逐字节一致）、压缩 / 工具轮次逻辑。

## 需求

### FR-1 NIM / LM Studio provider 接入（P0）
- `provider_resolver.py`：在 `PROVIDER_MAP` 增 `nim` / `lmstudio` → `LiteLLMProvider`，
  并在 `MODEL_PREFIX_MAP` 或 `_normalized_model` 中保证 bare model id 加 `openai/` 前缀
  （这两者本质是 OpenAI 兼容 gateway，需 base_url + 前缀，与移动云同路）。
- 默认 base_url：NIM `http://localhost:8000/v1`、LM Studio `http://localhost:1234/v1`；
  无密钥本机类 provider 须填写可访问 API 地址才算"已配置"（对齐 Ollama 规则）。
- `drop_params` 兼容：本地 gateway 多不支持 `tool_choice`，默认开启 `drop_params`。

### FR-2 执行位置决策器（P0.5 核心）
- 新增 `agenticx/runtime/routing/execution_router.py`（运行时层，区别于 embodiment 的 MAI-UI 组件），
  复用 / 包装 `DeviceCloudRouter` 的规则引擎，但：
  - 输入信号来自请求侧：`data_sensitivity`（复用 guardrails / 敏感词）、`task_complexity`
    （预估，可由消息长度 + 是否含 @file / 多工具意图粗估）、`network_reachable`、`device_backend_healthy`。
  - 输出为 `(provider_name, model_name, decision: RoutingDecision)`，而非 provider 实例
    （实例仍由 `ProviderResolver.resolve` 统一构造，避免两套构造路径）。
- 决策优先级（在 `auto` 模式下）：
  1. 本地后端不健康 / 未配置 → 云端（reason: device_unavailable）。
  2. 敏感数据命中 → 本地（reason: privacy）；若本地不可用则**拒绝降级到云**或显式提示（隐私优先）。
  3. 复杂度 > 阈值 / 跨工具意图 / 低置信 → 云端。
  4. 默认 → 本地（低延迟、零 token）。
- `cloud_only` 模式：决策器直接返回当前会话 provider/model，**完全短路**，零行为变更。

### FR-3 本地后端健康探测
- 新增轻量探测：对配置的本地 provider base_url 做 `GET {base}/models`（OpenAI 兼容标准端点），
  带 ≤2s 超时；结果带 TTL 缓存（如 30s），避免每轮请求阻塞。
- localhost 请求须绕过系统 SOCKS/HTTP 代理（对齐飞书 / 微信 sidecar 既有处理：`httpx` 用
  `AsyncHTTPTransport()` 或 `--noproxy`），否则本机探测会被代理吞掉。

### FR-4 配置节
`~/.agenticx/config.yaml` 新增：
```yaml
routing:
  mode: cloud_only        # cloud_only | auto | device_first
  device_provider: ollama # 本地 provider key
  device_model: ""        # 本地模型名（空则用该 provider 默认 model）
  cloud_provider: ""       # 云端 provider key（空则用会话当前 provider）
  cloud_model: ""
  complexity_threshold: 5
  privacy_strict: true     # 敏感命中且本地不可用时是否拒绝降级到云
```
- `ConfigManager` 增 `routing` 读取与默认值；缺省即 `cloud_only`（保证旧环境零回归）。

### FR-5 决策接入 chat 路径
- `server.py` 的 `_resolve_llm`（或其上游）在解析前调用决策器，得到 provider/model 后
  再交给 `ProviderResolver.resolve`；决策 `reason` 写入 SSE 元数据（如 `routing_decision` 事件），
  供前端状态区展示。
- 群聊 / 分身委派路径**本期不接入**（保持现有 avatar→session→meta 回退链不变），仅 Meta 主会话生效。

### FR-6 Desktop UI
- 设置面板"端云协同"区块归属：放在**模型服务（provider）tab** 下，作为该 tab 顶部/底部的
  **独立全局策略区块**（不塞进任何单个 provider 的详情卡——它是跨 provider 的全局策略，
  布局参照知识库 tab 的"检索三态"独立 section）。语义比 Automation tab 更贴合：路由本质是
  "本轮用哪个 provider/model 执行"，与模型服务心智一致，且 device/cloud provider 下拉引用的
  正是同 tab 已配置的 provider。
- 区块内容：三态开关 + 本地 provider 下拉（仅列出已配置的 ollama/nim/lmstudio）+ 阈值。
  持久化到 config.yaml。
- 主聊天窗格状态区：本轮若走本地，显示一个轻量 chip（如"本地 · ollama/qwen2.5"），
  hover 显示决策原因；走云端则不打扰（默认态）。
- 视觉与现有 chips / 三态开关一致，不新造控件语义。

## 验收标准

- AC-1：`routing.mode=cloud_only`（默认）时，对话链路与改造前**逐字节一致**，无任何路由开销可观测回归。
- AC-2：`auto` 模式下，含敏感词（如"身份证/银行卡"）的请求在本地后端健康时走本地 provider，
  SSE `routing_decision.reason=privacy`。
- AC-3：本地后端不可达（探测失败）时，`auto` / `device_first` 均回退云端，reason=device_unavailable，
  不抛错、不阻塞。
- AC-4：NIM（`localhost:8000/v1`）与 LM Studio（`localhost:1234/v1`）配置后可作为 device_provider
  正常完成一轮对话。
- AC-5：本地探测对 localhost 不经系统代理；探测超时 ≤2s 且带 TTL 缓存，不拖慢每轮首 token。
- AC-6：Desktop 三态开关与本地 provider 选择持久化；切换后下一轮即生效；窗格 chip 正确反映路由结果。
- AC-7：`privacy_strict=true` 且敏感命中但本地不可用时，按配置拒绝降级（明确提示），不静默上云。

## 实施步骤

1. **provider（FR-1）**：改 `agenticx/llms/provider_resolver.py`，加 `nim`/`lmstudio` 映射与前缀；
   `tests/` 加解析单测。
2. **决策器（FR-2）**：新增 `agenticx/runtime/routing/execution_router.py`，复用 `DeviceCloudRouter`
   规则，改为返回 `(provider, model, decision)`；纯函数化便于测。
3. **健康探测（FR-3）**：新增 `agenticx/runtime/routing/device_probe.py`，httpx 绕代理 + TTL 缓存。
4. **配置（FR-4）**：`config_manager.py` 增 `routing` 节默认值与读取。
5. **接入（FR-5）**：`server.py` 在 `_resolve_llm` 上游接入决策器，SSE 透出 `routing_decision`。
6. **Desktop（FR-6）**：设置面板三态开关 + provider 选择 + IPC 落盘；窗格状态 chip。
7. **测试**：`tests/test_execution_router.py`（cloud_only 短路 / privacy / device_unavailable /
   complexity）、provider 解析单测、device_probe 超时与缓存单测。
8. **验证**：跑新增测试文件 + `desktop` typecheck；本机起 Ollama 跑一轮 auto 模式 e2e。

## 风险与决策

- **隐私降级语义**：敏感命中但本地不可用是危险边界。默认 `privacy_strict=true`（拒绝上云 + 提示），
  由用户显式放宽，避免"以为本地处理了其实上了云"。
- **复杂度预估不准**：首版用粗启发式（消息长度 + @file/多工具意图），不引入额外模型；
  作为 `auto` 的弱信号，错判最坏只是多花一次云端调用，可接受。后续可用观察式学习优化。
- **不接入群聊 / 委派**：避免与既有 avatar provider 回退链冲突造成回归；本期范围只覆盖 Meta 主会话。
- **DGX Spark 体验预期**：273 GB/s 带宽下大模型本地吞吐有限，文档与 UI 文案不夸大"本地大模型秒回"，
  引导用户在 device_provider 选 7B–13B 级模型。
- **embodiment 既有 DeviceCloudRouter 去留**：本期**包装复用**其规则引擎，不删除、不改其对外签名，
  避免影响 embodiment 现有调用方；运行时新组件独立演进。
