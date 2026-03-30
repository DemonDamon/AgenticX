---
name: IM 远程指令网关（飞书 + 微信接入）
overview: |
  让用户通过手机上的飞书/微信给 Machi 发消息，由云端中继转发到桌面端 Agent 执行，
  实现「躺床上一句话远程操控电脑」的产品体验。
todos:
  - id: phase-0
    content: "Phase 0: 云端 Webhook Gateway 基础设施"
    status: in_progress
  - id: phase-1
    content: "Phase 1: 飞书机器人接入"
    status: pending
  - id: phase-2
    content: "Phase 2: 微信接入（企业微信优先）"
    status: pending
  - id: phase-3
    content: "Phase 3: Desktop 远程模式对接"
    status: pending
  - id: phase-4
    content: "Phase 4: 执行结果回传 + 多轮对话"
    status: pending
  - id: phase-5
    content: "Phase 5: Siri 快捷指令 + 更多入口"
    status: pending
isProject: true
---

# IM 远程指令网关 — 飞书 + 微信接入

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## 产品目标

**一句话：** 用户在手机飞书/微信里给 Machi 机器人发一条消息，Machi 桌面端自动执行并回复结果。

**核心用户场景：**

- 「找到桌面上的年终汇报 PDF 发给 Mike」
- 「帮我查一下昨天 git commit 的内容，总结成周报」
- 「打开 VS Code 里的 AgenticX 项目，跑一下测试」
- 「把 ~/Downloads 下最新的截图上传到飞书文档」

## 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户手机                                │
│  ┌─────────┐  ┌─────────┐  ┌───────┐  ┌──────────┐      │
│  │  飞书    │  │ 企微/微信 │  │ Siri  │  │ 钉钉     │      │
│  └────┬────┘  └────┬────┘  └───┬───┘  └────┬─────┘      │
└───────┼────────────┼───────────┼───────────┼─────────────┘
        │            │           │           │
        ▼            ▼           ▼           ▼
┌──────────────────────────────────────────────────────────┐
│              Cloud Relay Gateway (公网)                    │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │ /webhook/feishu│  │/webhook/wecom  │  ... 更多适配器   │
│  └───────┬────────┘  └───────┬────────┘                  │
│          │                   │                           │
│          ▼                   ▼                           │
│  ┌─────────────────────────────────────┐                 │
│  │      Unified Message Router         │                 │
│  │  • 鉴权（device_id + token）          │                │
│  │  • 消息格式归一化                      │                │
│  │  • 设备在线状态管理                    │                 │
│  │  • 消息队列（Redis / 内存）            │                 │
│  └───────────────┬─────────────────────┘                 │
│                  │                                       │
│  ┌───────────────▼─────────────────────┐                 │
│  │      agx serve (Studio Server)      │                 │
│  │  POST /api/chat  ← 转发指令          │                 │
│  │  SSE 事件流     → 收集结果            │                 │
│  └───────────────┬─────────────────────┘                 │
└──────────────────┼───────────────────────────────────────┘
                   │ (远程模式)
                   ▼
┌──────────────────────────────────────────────────────────┐
│              Machi Desktop (用户电脑)                      │
│  • 连接远程 agx serve（已有 remote backend plan）          │
│  • 或：agx serve 直接部署在用户电脑上（本地模式）            │
│  • Agent 执行本地工具：bash, 文件操作, Computer Use         │
└──────────────────────────────────────────────────────────┘
```

### 两种部署拓扑


| 模式              | 适用场景              | agx serve 位置                     | 本地工具能力        |
| --------------- | ----------------- | -------------------------------- | ------------- |
| **A. 云+桌面**（推荐） | 用户电脑常开、需操作本机文件/应用 | 用户电脑本地运行 + Webhook Gateway 在云端转发 | 完整            |
| **B. 纯云端**      | 纯 LLM 对话/远程开发机    | 云主机                              | 受限（只能操作云主机文件） |


**MVP 优先做拓扑 A**：Gateway 部署在云端（Vercel / 轻量 VPS），Gateway 把消息通过 WebSocket/长轮询推送到用户电脑上的 `agx serve`。

---

## Phase 0: Webhook Gateway 基础设施

### 设计决策

**Gateway 的定位：** 轻量级消息中继服务，不包含 LLM 逻辑，只做：

1. 接收各 IM 平台的 Webhook 回调
2. 消息格式归一化
3. 通过 WebSocket 通道推送给已连接的 Machi 实例
4. 把 Machi 的回复转发回 IM 平台

**技术选型：**

- **语言：** Python（与 agenticx 生态统一，可复用依赖）
- **框架：** FastAPI（与 studio server 一致）
- **部署：** 独立进程，可部署在同一台云主机，也可分离
- **消息通道：** WebSocket（Gateway ↔ 用户电脑的 agx serve 之间）
- **队列：** 先用内存 asyncio.Queue，后续可升级 Redis

### Task 0.1: 创建 Gateway 模块骨架

**Files:**

- Create: `agenticx/gateway/__init__.py`
- Create: `agenticx/gateway/app.py` — FastAPI 应用
- Create: `agenticx/gateway/models.py` — 统一消息模型
- Create: `agenticx/gateway/router.py` — 消息路由与设备管理
- Create: `agenticx/gateway/adapters/__init__.py` — IM 适配器基类

**Requirements:**

- FR-0.1: 定义统一消息协议 `GatewayMessage`：

```python
class GatewayMessage(BaseModel):
    message_id: str           # 各平台原始消息 ID
    source: str               # "feishu" | "wecom" | "wechat" | "siri"
    sender_id: str            # 发送者标识
    sender_name: str          # 发送者显示名
    content: str              # 文本内容
    content_type: str = "text"  # "text" | "image" | "file" | "voice"
    attachments: list = []    # 附件列表
    timestamp: float          # 发送时间戳
    raw: dict = {}            # 原始平台数据（调试用）
    device_id: str            # 目标 Machi 设备标识
```

- FR-0.2: 定义 `GatewayReply` 回传消息：

```python
class GatewayReply(BaseModel):
    message_id: str
    source: str               # 原始来源平台
    reply_to_sender_id: str
    content: str
    content_type: str = "text"
    attachments: list = []
```

- FR-0.3: 定义 `IMAdapter` 协议（Protocol）：

```python
class IMAdapter(Protocol):
    platform: str
    async def verify_webhook(self, request: Request) -> Response: ...
    async def parse_message(self, request: Request) -> GatewayMessage | None: ...
    async def send_reply(self, reply: GatewayReply) -> bool: ...
```

### Task 0.2: WebSocket 设备通道

**Files:**

- Modify: `agenticx/gateway/app.py`
- Create: `agenticx/gateway/device_manager.py`

**Requirements:**

- FR-0.4: Gateway 暴露 `ws://gateway/ws/device/{device_id}` 端点
- FR-0.5: 用户电脑上的 agx serve 启动时（或独立 agent-gateway-client）主动连接此 WebSocket
- FR-0.6: 连接时携带 `token` 鉴权（URL query 或首帧验证）
- FR-0.7: `DeviceManager` 维护 `{device_id: WebSocket}` 在线表
- FR-0.8: 收到 IM 消息后查找 `device_id` 对应的 WebSocket，推送 `GatewayMessage` JSON
- FR-0.9: 设备离线时消息入 pending 队列（内存，最多 100 条，24h 过期）

**连接鉴权流程：**

```
1. 用户在 ~/.agenticx/config.yaml 配置:
   gateway:
     enabled: true
     url: wss://gateway.agxbuilder.com/ws/device/{device_id}
     device_id: "damon-macbook-pro"   # 用户自定义或自动生成
     token: "xxxx"                     # 与 Gateway 侧匹配

2. agx serve 启动时自动连接 Gateway WebSocket
3. Gateway 验证 token → 注册设备 → 开始转发消息
```

### Task 0.3: agx serve 端 Gateway Client

**Files:**

- Create: `agenticx/gateway/client.py` — WebSocket 客户端
- Modify: `agenticx/studio/server.py` — 启动时可选开启 Gateway 连接
- Modify: `agenticx/cli/main.py` — `serve` 命令新增 `--gateway` 参数

**Requirements:**

- FR-0.10: `GatewayClient` 在 agx serve 启动时后台连接 Gateway WebSocket
- FR-0.11: 收到 `GatewayMessage` 后，自动创建或复用一个 session，调用 `/api/chat` 内部逻辑
- FR-0.12: 收集 SSE 事件流的最终回复文本，封装为 `GatewayReply` 回传 Gateway
- FR-0.13: 断线自动重连（指数退避，5s → 10s → 30s → 60s 上限）
- FR-0.14: 支持 `agx serve --gateway` 显式启用，或配置文件 `gateway.enabled: true`
- AC-1: 不启用 Gateway 时，agx serve 行为完全不变

---

## Phase 1: 飞书机器人接入

### 为什么飞书优先

1. **官方开放平台完善**：企业自建应用 → 机器人 → 事件订阅，全流程合规
2. **个人开发者可用**：测试企业即可开发调试
3. **事件回调稳定**：HTTP 回调 + 消息卡片，无灰色地带
4. **已有飞书 MCP**：当前的 `user-feishu-mcp` 是文档操作类 MCP，可在 Agent 工具链中互补

### Task 1.1: 飞书应用创建指南

**不写代码，产出配置文档**

在飞书开放平台创建「企业自建应用」，配置：

- 应用类型：企业自建应用（个人测试企业即可）
- 启用「机器人」能力
- 事件订阅：
  - `im.message.receive_v1`（接收消息）
  - 回调地址：`https://<gateway>/webhook/feishu`
- 权限：
  - `im:message` / `im:message:send_as_bot`（发消息）
  - `im:message.receive_event`（接收消息事件）
- 记录 `App ID` + `App Secret` + `Encrypt Key` + `Verification Token`

### Task 1.2: 飞书 Adapter 实现

**Files:**

- Create: `agenticx/gateway/adapters/feishu.py`

**Requirements:**

- FR-1.1: 实现飞书 Webhook 验证（challenge-response）
- FR-1.2: 解析 `im.message.receive_v1` 事件，提取文本、图片、文件消息
- FR-1.3: 飞书消息解密（AES-CBC，Encrypt Key）
- FR-1.4: 文本消息 → `GatewayMessage`
- FR-1.5: 实现 `send_reply()` — 调用飞书 OpenAPI 发送消息
  - `POST https://open.feishu.cn/open-apis/im/v1/messages`
  - 支持文本回复 + Markdown 卡片回复（长文本用卡片）
- FR-1.6: 维护 `tenant_access_token` 自动续期

**关键实现：**

```python
class FeishuAdapter:
    platform = "feishu"

    def __init__(self, app_id: str, app_secret: str, encrypt_key: str, verification_token: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.encrypt_key = encrypt_key
        self.verification_token = verification_token
        self._token: str = ""
        self._token_expires: float = 0

    async def verify_webhook(self, request: Request) -> Response | None:
        """Handle Feishu URL verification challenge."""
        body = await request.json()
        if "challenge" in body:
            return JSONResponse({"challenge": body["challenge"]})
        return None

    async def parse_message(self, request: Request) -> GatewayMessage | None:
        """Parse im.message.receive_v1 event into GatewayMessage."""
        body = await request.json()
        # Decrypt if encrypted
        if self.encrypt_key and "encrypt" in body:
            body = self._decrypt(body["encrypt"])

        header = body.get("header", {})
        event = body.get("event", {})
        if header.get("event_type") != "im.message.receive_v1":
            return None

        message = event.get("message", {})
        sender = event.get("sender", {}).get("sender_id", {})
        content = json.loads(message.get("content", "{}"))

        return GatewayMessage(
            message_id=message.get("message_id", ""),
            source="feishu",
            sender_id=sender.get("open_id", ""),
            sender_name=sender.get("sender_id", {}).get("open_id", ""),
            content=content.get("text", ""),
            content_type=message.get("message_type", "text"),
            timestamp=float(message.get("create_time", 0)) / 1000,
            raw=body,
            device_id=self._resolve_device_id(sender),
        )

    async def send_reply(self, reply: GatewayReply) -> bool:
        """Send reply via Feishu OpenAPI."""
        token = await self._get_tenant_token()
        # Truncate for text, use card for long content
        if len(reply.content) > 500:
            msg_body = self._build_card_message(reply.content)
        else:
            msg_body = {"msg_type": "text", "content": json.dumps({"text": reply.content})}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages",
                params={"receive_id_type": "open_id"},
                headers={"Authorization": f"Bearer {token}"},
                json={"receive_id": reply.reply_to_sender_id, **msg_body},
            )
            return resp.status_code == 200
```

### Task 1.3: 飞书消息 ↔ 设备 ID 映射

**Files:**

- Modify: `agenticx/gateway/adapters/feishu.py`
- Create: `agenticx/gateway/user_device_map.py`

**Requirements:**

- FR-1.7: 用户首次给机器人发消息时，回复引导绑定设备：「请发送你的设备绑定码（在 Machi 设置中获取）」
- FR-1.8: 绑定关系持久化到文件（`~/.agenticx/gateway/device_bindings.json`）
- FR-1.9: 已绑定用户发消息时自动路由到对应设备
- FR-1.10: 支持一个飞书用户绑定多台设备（手动切换活跃设备）

---

## Phase 2: 微信接入

### 策略分析


| 方案                          | 合规性     | 稳定性   | 成本  | 推荐度     |
| --------------------------- | ------- | ----- | --- | ------- |
| **企业微信自建应用**                | 合规      | 高     | 免费  | **首选**  |
| 企业微信第三方应用                   | 合规      | 高     | 需审核 | 正式版     |
| 微信公众号（服务号）                  | 合规      | 高     | 需认证 | 备选      |
| 个人微信 Hook（如 itchat/wechaty） | **不合规** | **低** | 免费  | **不推荐** |


**MVP 选择：企业微信自建应用**

- 个人可免费注册企业微信
- 有完善的消息回调 API
- 员工在微信里也能收到企业微信消息（打通互联）

### Task 2.1: 企业微信 Adapter 实现

**Files:**

- Create: `agenticx/gateway/adapters/wecom.py`

**Requirements:**

- FR-2.1: 实现企业微信消息回调验证（URL 验证 + 消息解密 AES）
- FR-2.2: 解析文本消息事件 → `GatewayMessage`
- FR-2.3: 实现 `send_reply()` — 调用企业微信 API 发送应用消息
  - `POST https://qyapi.weixin.qq.com/cgi-bin/message/send`
- FR-2.4: 维护 `access_token` 自动续期（7200s 有效期）
- FR-2.5: 支持 Markdown 消息格式（企业微信原生支持 Markdown）

**企业微信消息解密要点：**

```python
# 企业微信用 AES-256-CBC 加密
# Encrypt Key = Base64Decode(EncodingAESKey + "=")
# 解密后验证 ReceiveId == CorpId
```

### Task 2.2: 企业微信应用创建文档

**产出配置文档，不写代码**

- 在企业微信管理后台创建「自建应用」
- 启用「接收消息」模式（API 接收）
- 配置回调 URL：`https://<gateway>/webhook/wecom`
- 记录 `CorpID` + `AgentID` + `Secret` + `Token` + `EncodingAESKey`
- 可信域名配置

---

## Phase 3: Desktop 远程模式对接

> 依赖已有 plan: `.cursor/plans/2026-03-24-desktop-remote-backend.plan.md`

### Task 3.1: agx serve 集成 Gateway Client

在已有远程后端 plan 基础上，让 `agx serve` 启动时自动连接 Gateway：

**Files:**

- Modify: `agenticx/cli/main.py` — serve 命令读取 gateway 配置
- Modify: `agenticx/studio/server.py` — lifespan 事件中启动/停止 GatewayClient

**Requirements:**

- FR-3.1: `~/.agenticx/config.yaml` 新增 `gateway` 配置节：

```yaml
gateway:
  enabled: false
  url: "wss://gateway.agxbuilder.com"
  device_id: ""       # 自动生成 UUID 或用户自定义
  token: ""           # 与 Gateway 侧的设备认证 token
```

- FR-3.2: `agx serve --gateway` 启用，或 config `gateway.enabled: true`
- FR-3.3: Gateway Client 在后台协程运行，不阻塞主服务
- FR-3.4: 收到 `GatewayMessage` 后，映射到内部 `/api/chat` 调用：
  - 自动创建或复用 `im-{source}-{sender_id}` session
  - 设置 `user_display_name` 为 IM 用户名
  - `user_input` = 消息文本
- FR-3.5: 收集 SSE 流中所有 `chunk`/`final` 文本拼接为回复
- FR-3.6: 回复通过 WebSocket 发回 Gateway，Gateway 调对应 Adapter 的 `send_reply()`

### Task 3.2: Desktop 设置面板「远程指令」配置

**Files:**

- Modify: Desktop 设置面板（在已有远程服务器设置基础上）

**Requirements:**

- FR-3.7: 设置面板新增「远程指令」分区：
  - 设备绑定码显示（可复制到飞书/微信完成绑定）
  - Gateway 连接状态指示
  - 已绑定 IM 账号列表
  - 开关：是否允许远程执行本机工具

---

## Phase 4: 执行结果回传 + 多轮对话

### Task 4.1: 结果摘要 + 长文本处理

**Requirements:**

- FR-4.1: Agent 回复超 2000 字时，自动摘要 + 全文链接（飞书文档 / 文件）
- FR-4.2: 工具执行结果（如文件列表、命令输出）格式化为 IM 友好格式
- FR-4.3: 图片类结果支持直接发送（飞书/企微都支持图片消息）

### Task 4.2: 多轮对话上下文

**Requirements:**

- FR-4.4: 同一 IM 用户的消息复用同一 session，保持对话上下文
- FR-4.5: 支持 「/新对话」 指令重置 session
- FR-4.6: 支持 「/状态」 指令查看 Agent 执行进度
- FR-4.7: 支持 「/取消」 指令中断正在执行的任务

### Task 4.3: 异步执行 + 进度推送

**Requirements:**

- FR-4.8: 长任务（>30s）先回复「收到，正在执行...」
- FR-4.9: 执行过程中的关键节点推送进度（如「正在搜索文件...」「已找到 3 个匹配文件」）
- FR-4.10: 完成后推送最终结果
- FR-4.11: 需要用户确认的操作（如删除文件），通过 IM 消息卡片 + 按钮交互

---

## Phase 5: Siri 快捷指令 + 更多入口（后续迭代）

### Task 5.1: Siri 快捷指令

- 创建 iOS 快捷指令：语音 → 文本 → POST `https://<gateway>/api/command`
- Gateway 新增 `/api/command` REST 端点（非 Webhook 回调模式）
- 结果推送到 iOS 通知 / 快捷指令输出

### Task 5.2: 钉钉机器人

- 钉钉开放平台创建机器人
- 实现 `DingTalkAdapter`
- 回调验证 + 消息解析 + outgoing 消息

---

## 实施优先级与路线图

```
Week 1: Phase 0 (Gateway 基础设施) + Phase 1 (飞书 Adapter)
         ┌──────────────────────────────────────┐
         │ Gateway 骨架 + WebSocket 通道          │
         │ + FeishuAdapter                       │
         │ = MVP: 飞书发消息 → 本机 Agent 执行     │
         └──────────────────────────────────────┘

Week 2: Phase 2 (企业微信 Adapter) + Phase 3 (Desktop 对接)
         ┌──────────────────────────────────────┐
         │ WeComAdapter + 设置面板 UI             │
         │ = 双 IM 入口可用                       │
         └──────────────────────────────────────┘

Week 3: Phase 4 (结果回传 + 多轮对话)
         ┌──────────────────────────────────────┐
         │ 长文本摘要 + 进度推送 + 交互确认       │
         │ = 完整用户体验                         │
         └──────────────────────────────────────┘

Week 4+: Phase 5 (Siri + 钉钉 + 更多入口)
```

**最小可演示版本 = Phase 0 + Phase 1 中的 Task 0.1-0.3 + Task 1.1-1.2**

---

## 配置示例

### Gateway 侧（云端）`gateway_config.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 8081

adapters:
  feishu:
    enabled: true
    app_id: "cli_xxxxxx"
    app_secret: "xxxxxxxxxxxx"
    encrypt_key: "xxxxxxxxxxxx"
    verification_token: "xxxxxxxxxxxx"

  wecom:
    enabled: true
    corp_id: "wwxxxxxxxxxx"
    agent_id: 1000002
    secret: "xxxxxxxxxxxx"
    token: "xxxxxxxxxxxx"
    encoding_aes_key: "xxxxxxxxxxxx"

devices:
  auth_tokens:
    - device_id: "damon-macbook-pro"
      token: "xxxxxxxxxxxx"
```

### 用户电脑侧 `~/.agenticx/config.yaml` 新增

```yaml
gateway:
  enabled: true
  url: "wss://gateway.agxbuilder.com"
  device_id: "damon-macbook-pro"
  token: "xxxxxxxxxxxx"
```

---

## 风险与缓解


| 风险              | 影响           | 缓解                               |
| --------------- | ------------ | -------------------------------- |
| 飞书/企微 API 变更    | Adapter 失效   | 版本锁定 + 监控告警                      |
| 用户电脑离线          | 消息积压         | pending 队列 + 超时通知「设备离线」          |
| 安全：恶意指令         | Agent 执行危险操作 | 远程模式默认 interactive（需确认），敏感操作二次验证 |
| 安全：WebSocket 劫持 | 第三方冒充设备      | TLS + Token + device_id 绑定       |
| 消息延迟            | 用户体验差        | Gateway → agx serve 同城部署，或用户自部署  |
| 个人微信            | 不可合规接入       | **明确不做个人微信 Hook**，引导用企业微信        |
| 飞书测试企业限制        | 人数/功能受限      | MVP 阶段足够，正式版申请正式企业应用             |


---

## 与已有 Plan 的关系


| 已有 Plan                                           | 关系                                    |
| ------------------------------------------------- | ------------------------------------- |
| `2026-03-24-desktop-remote-backend.plan.md`       | **前置依赖**的远程模式基础设施（Phase 2-3 的 IPC 改造） |
| `2026-03-24-computer-use-internalization.plan.md` | Agent 执行端能力，远程指令场景下的核心工具              |
| `2026-03-23-extension-ecosystem.plan.md`          | 各 IM Adapter 可作为 Bundle/Extension 分发  |


---

## CLI 入口

```bash
# 启动 Gateway 服务（云端）
agx gateway --config gateway_config.yaml

# 启动 agx serve 并连接 Gateway（用户电脑）
agx serve --gateway

# 或仅通过配置文件
# ~/.agenticx/config.yaml 中 gateway.enabled: true
agx serve
```

