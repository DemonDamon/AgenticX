---
name: 企业微信集成（客户群答疑）
overview: |
  在 Near Desktop「服务器连接 / 远程指令」设置页，于现有「飞书集成」「微信集成」卡片之后，
  新增一个并列的「企业微信集成」Panel；并打通后端，使企业微信智能机器人能在客户群里
  接收 @ 提问、调用云端 Agent + 知识库检索、把回答发回群聊，用于客户答疑场景。
todos:
  - id: phase-1
    content: "Phase 1: Desktop「企业微信集成」设置面板 UI + 配置持久化"
    status: pending
  - id: phase-2
    content: "Phase 2: 企微 Adapter 群聊收发（chatid / chattype / 群回复）"
    status: pending
  - id: phase-3
    content: "Phase 3: 客服答疑路由模式（直连云端 Agent，跳过设备绑定）"
    status: pending
  - id: phase-4
    content: "Phase 4: Gateway 读取 Desktop 配置打通 + 部署引导"
    status: pending
  - id: phase-5
    content: "Phase 5: 文档 + 冒烟测试"
    status: pending
isProject: true
---

# 企业微信集成（客户群答疑）

> Plan-Id: 2026-06-02-wecom-customer-group-integration

## 1. 背景与目标

用户希望在企业微信**客户群**里接入一个 AI Agent 负责答疑（参考截图：客户在群里问「北京日立是什么」「有相关提示词的文档吗」，由 Agent 检索文档库后回答）。

落点是在 Near Desktop **设置 → 服务器连接 / 远程指令** 页面，于现有「飞书集成」「微信集成」两张卡片之后，**新增一张「企业微信集成」卡片**（截图位置）。

**一句话目标：** 在企业微信客户群 `@机器人` 提问 → 企微回调到公网 Gateway → 云端 Agent + 知识库检索 → 回答发回群聊。

## 2. 关键约束与设计决策（务必先读）

### 2.1 企微没有官方长连接 —— 必须走公网回调

| 渠道 | 接收消息方式 | 是否需公网 | Near 现状 |
|------|-------------|-----------|----------|
| 飞书 | 官方 WebSocket 长连接（`agx feishu`） | 否 | 本地起进程，已支持 |
| 个人微信(iLink) | sidecar 扫码绑定 | 否 | 本地 sidecar，已支持 |
| **企业微信** | **管理后台配置回调 URL（智能机器人 / 自建应用）** | **是** | 仅 `wecom.py` 半成品，单聊、无群支持 |

**决策 D1：** 企微集成 Panel **不照搬飞书长连接形态**，而采用「**凭据配置 + 公网 Gateway 回调**」形态（类似飞书集成里的「Webhook 模式」子 tab）。Desktop 端只负责**填写并持久化凭据 + 展示回调 URL + 部署引导**，实际接收/回复运行在用户自行部署的公网 `agx gateway` 进程。

**决策 D2：** 客户群答疑**不需要操控本机电脑**，因此走「**客服直连模式**」：Gateway 收到企微群消息后**直接调用云端 `agx serve` 的 `/api/chat`**，**跳过**现有 `MessageRouter` 的「绑定本机设备 + WebSocket 转发」流程（那条链路是为「远程操控电脑」设计的）。

**决策 D3：** 触发方式默认 **`@机器人`**（群聊场景，避免每条消息都回造成刷屏）；单聊默认全部响应。可配置关键词触发。

**决策 D4（已定）：** 企微接入形态采用 **智能机器人**（企微官方主打的 AI 群答疑能力，回调含 `aibotid` / `chattype`，支持流式回复与模板卡片）。Phase 2/3 按此形态实现，不做自建应用 `appchat` 分支。

### 2.2 不在本 plan 范围内（避免 scope creep）

- 不改飞书 / 个人微信现有逻辑。
- 不实现「客户群群发营销」（`externalcontact/add_msg_template`，需人工确认，属另一诉求）。
- 不预置敏感词 / 行业关键词清单（由客户分阶段提供，只预留接入位）。
- 知识库本身已存在（`knowledge_search`），本 plan 只负责把答疑 Agent 接到知识库，不改 KB 实现。

## 3. 架构

```
┌──────────────────────────────────────────────────────────┐
│ 客户在企业微信客户群 @机器人 提问                          │
└───────────────┬──────────────────────────────────────────┘
                │ 加密回调 POST (chatid, chattype=group, from)
                ▼
┌──────────────────────────────────────────────────────────┐
│ 公网 Gateway（用户部署）  agx gateway                       │
│  /webhook/wecom  →  WeComAdapter.parse_post()              │
│                     • 解密、验签                            │
│                     • 解析 chatid / chattype / @ 提及       │
│                     • 客服直连模式 → 调云端 /api/chat       │
│  WeComAdapter.send_reply()  →  群回复（智能机器人回复接口） │
└───────────────┬──────────────────────────────────────────┘
                │ POST /api/chat (session = 群粒度)
                ▼
┌──────────────────────────────────────────────────────────┐
│ 云端 agx serve（Agent + knowledge_search）                  │
│  • 答疑分身（绑定知识库、FAQ、拒答策略、引用格式）           │
│  • 每个群独立 session_id（避免串上下文）                    │
└──────────────────────────────────────────────────────────┘

           ▲ Desktop 仅做配置入口（不参与运行时收发）
┌──────────┴───────────────────────────────────────────────┐
│ Near Desktop 设置 → 服务器连接 → 「企业微信集成」卡片        │
│  填 CorpID / AgentId / Secret / Token / EncodingAESKey      │
│  展示回调 URL + 部署引导，保存到 ~/.agenticx/config.yaml    │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 1: Desktop「企业微信集成」设置面板 UI + 配置持久化

### Task 1.1: 设置面板新增「企业微信集成」Panel

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`（在「微信集成」`</Panel>`（约 8301 行）之后、`QrConnectModal` 之前插入新 `<Panel title="企业微信集成">`）

**Requirements:**
- FR-1.1: 新增 `<Panel title="企业微信集成">`，视觉与「飞书集成」「微信集成」一致（复用 `SettingsSwitch`、`bg-surface-panel` 等主题 token，不硬编码颜色）。
- FR-1.2: 顶部「启用」开关 `wecomEnabled`；启用后展示凭据表单：
  - CorpID（企业 ID）
  - AgentId（应用 / 机器人 ID，数字）
  - Secret（应用 Secret，密码框 + 显示/隐藏）
  - Token（回调 Token）
  - EncodingAESKey（回调 AES Key，密码框 + 显示/隐藏）
- FR-1.3: 展示**回调 URL** 引导：`https://<你的网关域名>/webhook/wecom`，并提供一键复制。
- FR-1.4: 说明文案（`text-text-faint`）：企微需公网可达的 Gateway（区别于飞书长连接），并指向底部「远程部署参考」。文案须自然、不暴露内部路径。
- FR-1.5: 凭据 state 在打开设置时通过新 IPC `loadWecomConfig()` 回填；点底部「保存」时通过 `saveWecomConfig()` 落盘（与现有 `handleSave` 一致地纳入统一保存，参考 `saveFeishuConfig` 在 `handleSave` 中的调用，约 5936 行）。
- AC-1.1: 关闭再打开设置页，已填凭据正确回显。
- AC-1.2: 未启用时不渲染凭据表单；`typecheck + build` 绿。

### Task 1.2: 新增企微配置 IPC（main + preload + 类型声明）

**Files:**
- Modify: `desktop/electron/main.ts`（新增 `load-wecom-config` / `save-wecom-config` handler，参考 3390–3416 的飞书 handler）
- Modify: `desktop/electron/preload.ts`（暴露 `loadWecomConfig` / `saveWecomConfig`，参考 103–113）
- Modify: `desktop/src/global.d.ts`（或对应 `window.agenticxDesktop` 类型声明文件，新增方法签名）

**Requirements:**
- FR-1.6: `load-wecom-config` 从 `~/.agenticx/config.yaml` 读取 `wecom` 节，返回 `{ enabled, corpId, agentId, secret, token, encodingAesKey }`。
- FR-1.7: `save-wecom-config` 把上述字段 trim 后写入 `cfg.wecom`，调用 `saveAgxConfig(cfg)`。
- FR-1.8: 企微无本地进程，故 `save` **不** spawn 任何进程（区别于飞书的 `startFeishuProcess`），返回 `{ ok: true, restart_required: false }`。
- AC-1.3: 保存后 `~/.agenticx/config.yaml` 出现 `wecom:` 节，字段正确。

---

## Phase 2: 企微 Adapter 群聊收发

### Task 2.1: `WeComAdapter` 解析群消息

**Files:**
- Modify: `agenticx/gateway/adapters/wecom.py`
- Modify: `agenticx/gateway/models.py`（`GatewayMessage` 已有 `chat_id`；如需补 `chat_type` 字段则在此加，默认 `""`）

**Requirements:**
- FR-2.1: `parse_post()` 解析回调中的 `chatid`（群 ID）与 `chattype`（`single` / `group`）写入 `GatewayMessage.chat_id` 与 `chat_type`。
- FR-2.2: 群聊消息按 `@机器人` 触发：解析消息文本/被 @ 列表，未命中触发条件则返回 `None`（不应答）。单聊保持全部响应。
- FR-2.3: 按**智能机器人**回调结构实现（`aibotid` / `chattype` / `from`，见官方「接收事件」文档），注释标注来源；不实现自建应用 XML 分支（见决策 D4）。
- FR-2.4: `msgid` 去重（企微可能因网络重复回调），用内存 LRU/集合即可。
- AC-2.1: 单元测试用样例 payload（群 / 单聊各一）验证解析与触发判定。

### Task 2.2: `WeComAdapter.send_reply()` 群回复

**Files:**
- Modify: `agenticx/gateway/adapters/wecom.py`

**Requirements:**
- FR-2.5: 当 `chat_id` 为群且 `chat_type=group` 时，使用智能机器人「被动/主动回复」接口回到群（关联 `msgid`），而非现有 `message/send` 的 `touser` 单聊。
- FR-2.6: 长回答按企微限制分段或截断（text ≤ 2048 字节；超出转 markdown 或附「完整回复见…」摘要，复用 `_SUMMARY_MAX` 思路）。
- FR-2.7: `access_token` 续期逻辑复用现有 `_ensure_access_token()`。
- AC-2.2: 真群（测试客户群）`@机器人` 一条问题能收到一条回答。

---

## Phase 3: 客服答疑路由模式（直连云端 Agent）

### Task 3.1: Gateway 新增「客服直连」路由分支

**Files:**
- Modify: `agenticx/gateway/app.py`（`/webhook/wecom` 处理，约 161–181）
- Modify: `agenticx/gateway/router.py`（新增 `route_customer_service()` 或在 `route()` 前置分流）
- Create: `agenticx/gateway/cs_router.py`（可选，隔离客服模式逻辑，避免污染 `MessageRouter`）

**Requirements:**
- FR-3.1: 配置开关 `wecom.cs_mode`（默认 `true`）。开启时企微消息**不走**设备绑定/WebSocket，直接 `POST {studio_base_url}/api/chat`。
- FR-3.2: `session_id` 按**群粒度**生成并复用（如 `wecom-group-{chatid}`），保证同群多轮上下文连续、跨群隔离。
- FR-3.3: 可配置答疑分身 `wecom.avatar_id` 与默认模型；为空则用 Meta-Agent。
- FR-3.4: 收集 `/api/chat` 的 SSE 最终回复 → `WeComAdapter.send_reply()` 回群。
- FR-3.5: 失败/超时给群内可读兜底（如「暂时无法回答，已转人工」），并可选 @ 群主。
- AC-3.1: 端到端：测试群提问命中知识库文档并返回带出处的回答。

---

## Phase 4: Gateway 读取 Desktop 配置打通 + 部署引导

### Task 4.1: `agx gateway` 支持从 `~/.agenticx/config.yaml` 读取企微凭据

**Files:**
- Modify: `agenticx/gateway/config.py`（`load_gateway_config` 支持回退/合并 `~/.agenticx/config.yaml` 的 `wecom` 节；或在 CLI 层桥接）
- Modify: 对应 `agx gateway` CLI 入口（grep `gateway` CLI command 定位）
- Modify: `docs/gateway/gateway_config.example.yaml`（补 wecom 群聊 / cs_mode 字段示例）

**Requirements:**
- FR-4.1: Desktop 写入 `~/.agenticx/config.yaml` 的 `wecom` 节能被 `agx gateway` 识别（无需用户手抄到独立 `gateway_config.yaml`）。优先级与合并规则需明确并注释。
- FR-4.2: 新增字段（`cs_mode` / `avatar_id` / `trigger` 等）进入 `WeComAdapterConfig`。
- AC-4.1: 仅在 Desktop 填凭据 + 启动 `agx gateway` + `agx serve`，无需手改 YAML，即可跑通客户群答疑。

---

## Phase 5: 文档 + 冒烟测试

### Task 5.1: 文档

**Files:**
- Modify: `docs/gateway/im-remote-gateway-setup.md`（新增「企业微信客户群答疑」小节：管理后台配置智能机器人 / 回调 URL / 拉机器人进客户群 / 客户联系权限）
- Modify: `README_ZN.md`（IM 渠道接入表补企微客户群答疑能力，措辞诚实，标注「需公网 Gateway」）

### Task 5.2: 冒烟测试

**Files:**
- Modify/Create: `tests/test_gateway_wecom.py`

**Requirements:**
- FR-5.1: 覆盖 `parse_post` 群/单聊解析、@ 触发判定、`msgid` 去重、群回复 payload 构造、cs_mode 直连分支（mock `/api/chat`）。
- AC-5.1: `pytest tests/test_gateway_wecom.py` 全绿。

---

## 4. 验收标准（整体）

1. Desktop 设置页在「微信集成」下方出现「企业微信集成」卡片，可填凭据并持久化、可回显。
2. 配置仅在 Desktop 完成，不需手改 YAML，`agx gateway` 即可识别。
3. 企业微信测试客户群里 `@机器人` 提问，能从知识库检索文档并把带出处的回答发回群聊。
4. 同群多轮上下文连续，跨群隔离。
5. 不影响飞书 / 个人微信现有功能；`typecheck + build` 与新增 `pytest` 全绿。

## 5. 风险与待确认

- **R1（已定，见决策 D4）：** 接入形态采用**智能机器人**；如后续企微后台能力受限需回退到自建应用 `appchat`，再单独评估。
- **R2：** 外部**客户群** vs 内部群权限不同；客户群可能需「客户联系」权限与服务商资质，企业资质不足时只能先在内部群验证。
- **R3：** 公网 Gateway 需 HTTPS + 备案/合规；回调 URL 验签、AES 解密依赖 `cryptography`。
- **R4：** 合规——机器人须标明 AI 身份；投资/敏感类问题走「检索+引用」或转人工，关键词清单由客户分阶段提供。
- **R5：** 企微频率限制，长回答需分段，避免触发限流。

## 6. 实施顺序建议

P1（Desktop UI + 配置，可独立交付演示）→ P2（群收发）→ P3（客服直连）→ P4（打通）→ P5（文档测试）。
Phase 1 完成即可在界面上演示「企微集成入口」，后端 P2–P4 串起端到端答疑。
