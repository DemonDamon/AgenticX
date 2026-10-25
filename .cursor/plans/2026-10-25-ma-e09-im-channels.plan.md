# MA-E09 IM 渠道（飞书优先）与版本路由

> **主规划裁决（2026-10-25，优先于正文）**：会话粒度：**群聊整群共用一个会话**（会话键 `chat_id`），单聊按用户一个会话（会话键 `open_id`）；版本变化时按正文规则切新会话。v1 只做长连接模式，HTTP 回调模式不做（已列入 master §8）。

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W5 · MA-E09）
Depends-on:
- MA-E01 / E02 / E06（**已实现**：`enterprise_agents.version_routing` / `latest_version`、`lib/ma/*` 路由样板、Vault 表与 `ma-vault-crypto.ts` 的 `openSecretPayload`）
- MA-E03（**已实现**：agent-runtime `build_app`、`AdminConsoleClient`、`AdminConsoleAgentRegistry`、`PgEventStore`）
- MA-E08 `.cursor/plans/pending/2026-10-25-ma-e08-schedules-webhooks.plan.md`（**未实现**；本文用其迁移编号之后的 `0066` / `0040`、复用其 `_add_background` 接线写法与 `HookedPgEventStore` 不需要；**以实际实现为准，实施前核对**）
- MA-E07（**未实现**，占用 `0064` / `0038`）

> 风险等级：中（长连接到外部 IM、持有第三方应用密钥）。
> **栈**：TS（db-schema / iam-core / admin-console）+ Python（agent-runtime；`agenticx/managed/protocol.py` 的 scope 常量）。复用 `agenticx/gateway` 现有代码但**不修改**它。
>
> **实施前必须核对**：
> 1. 迁移末项：本文用 **PG `0066_ma_channels` / MySQL `0040_ma_channels`**（E07 `0064/0038`、E08 `0065/0039` 合入后）；否则按实际末项 +1，journal `idx` 连续。
> 2. `schema-parity.test.ts` 表数（E08 后 88，本文 +4 → 92）。
> 3. `PAT_SCOPES`（E08 后 17 项，本文 +2 → 19）。
> 4. 运行环境 `python -c "import lark_oapi; lark_oapi.ws.Client"` 可用（agent-runtime 镜像需新增依赖，见 §5.11）。

---

## 0. 一句话目标

管理员在管理台「IM 渠道」里把一个飞书自建应用绑定到某个 Agent：应用 `app_id` 明文保存在渠道上，`app_secret` 只存在凭证库（渠道只保存 Vault 凭证引用）；版本策略选「跟随最新」或「固定版本」。agent-runtime 以**长连接**方式（企业侧出站，不需要公网回调地址）接收该应用的消息，把「私聊用户」或「群」映射为一个托管会话（`source=channel`），续接或新建会话、等待会话空闲，再把最后一条 `agent.message` 以飞书富文本回复到原消息。发布 Agent 新版本后，「跟随最新」的渠道在下一条消息即切到新版本（新开会话），「固定版本」的渠道不变。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §1.2 | Webhook / Channel：IM 接入；渠道可「跟随最新版本」或「固定版本」 | `ma_channels.routing` |
| §2.3 | `ma_channels` 唯一写入方 admin-console；会话面数据归 agent-runtime | D1：渠道配置归管理台；会话映射 / 去重 / 连接状态归运行时 |
| §4 决策 4 | 控制面 `/ma/v1/channels` → admin-console（nginx 正则已含 `channels`，`gateway.conf:95`） | §4.6 公共接口 |
| §4 决策 7 | 版本锁定；渠道与桌面分发可选跟随最新或固定 | D4 |
| §5.2 | Session `source` 含 `channel` | `CreateSessionRequest(source="channel")` |
| §7 W5 门 | 「飞书渠道绑定 Agent 选跟随最新，发布新版本后渠道立即生效，选固定版本则不变」 | FR-9、§8 |
| §9 MA-E09 | 新表 `ma_channels`（飞书优先），`follow_latest` / `pinned`；渠道消息创建或续接会话 | 全文 |
| §12「Vault 与记忆库在租户内共享…门户服务 PAT…」行 | 凭证只写不读、解析须审计、审计失败不返回密钥 | §4.7 内部接口审计 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/gateway/adapters/feishu.py` | 25–40、57–120 | `FeishuAdapter(app_id, app_secret, encrypt_key="", verification_token="")`；`process_json(body) -> (immediate_json, GatewayMessage)`：只处理 `header.event_type == "im.message.receive_v1"`，解析 `message.content` 的 `text`、`sender.sender_id.open_id`、`chat_id`、`message_id`，`raw` 为整个事件 | **直接复用**解析（D6） |
| 同上 | 127–187 | `send_reply` 只支持 `open_id` 纯文本，固定 `open.feishu.cn` | **不复用**发送；本文自写回复（需回复到原消息、富文本、可配域名） |
| `agenticx/gateway/feishu_longconn.py` | 101–113 | 可选导入 `lark_oapi`（`lark.ws.Client`、`EventDispatcherHandler`、`P2ImMessageReceiveV1`） | 子进程用同一 SDK |
| 同上 | 158 | `md_to_feishu_post(markdown, title="") -> dict`（`{"zh_cn": {"title","content":[[...]]}}`）纯函数 | **直接复用**富文本转换 |
| 同上 | 272–274 | `_is_new_chat(text)`：`新对话 / new chat / /new / /reset / 重置 / 清空上下文` | 私有函数，本文按同一集合在自己的模块内定义常量（不 import 私有名） |
| 同上 | 1147–1166、1299–1318 | `EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(cb)`；`lark.ws.Client(app_id, app_secret, event_handler=..., log_level=...)` 阻塞运行；SDK 在模块级持有事件循环 | 一个进程只跑一个长连接 → 每个渠道一个子进程（D5） |
| `lark_oapi.ws.Client.__init__`（本机 SDK） | — | `(app_id, app_secret, log_level, event_handler, domain='https://open.feishu.cn', auto_reconnect=True)` | `domain` 可配（Lark 国际版） |
| `requirements.txt`（仓库根） | 80 | `lark-oapi>=1.3.0` 为注释掉的可选依赖 | agent-runtime 镜像须显式安装 |
| `enterprise/apps/agent-runtime/requirements.txt` | 1–6 | 无 `lark-oapi` | 追加 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/control_plane.py` | 185–268 | `AdminConsoleAgentRegistry.get_agent(tenant, agent_id) -> AgentRecord`（含 `latest_version`、`status`、`lifecycle`，10 秒缓存）；`get_version(..., None)` 取生效版本 | 版本路由读它（D4） |
| `agenticx/managed/host/service.py` | 107–154、162–188 | `create_session(principal, req)`、`post_events(principal, sid, raw)`、`list_events(principal, sid, after_seq, limit, types)`、`get_session` | 渠道处理在进程内直接调用 |
| `agenticx/managed/protocol.py` | 395–411 | `SessionRecord` 字段（`status`、`stop_reason`、`agent_version`、`archived_at`） | 会话可续接判断 |
| `enterprise/packages/iam-core/src/ma-vault-crypto.ts` | 87 | `openSecretPayload(sealed) -> Record<string,string>` | 内部接口解密 app secret |
| `enterprise/packages/iam-core/src/repos/ma-vault-validate.ts` | 1–8、442–450 | 凭证类型四种；`environment_variable`：`secret_name` + `secret_value` + `networking` | 渠道引用 `environment_variable` 凭证（D3） |
| `enterprise/packages/iam-core/src/repos/ma-vaults.ts` | 414、1065 | `findCredentialRow` 私有；`resolveVaultBundle` 要求会话引用 | 本文在 `ma-channels.ts` 内自行只读查询凭证行（不改 E06 文件） |
| `enterprise/packages/iam-core/src/repos/audit.ts` | 34 | `insertAuditEvent(input, dbOrTx?)` | 解析审计 |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 121 | `/admin/channels` 已被**网关上游渠道**（模型路由）占用 | 本文页面 slug 用 `agent-channels`，导航名「IM 渠道」 |
| `enterprise/apps/web-portal/src/lib/collab-room/ma-agent-reply.ts` | 19–26 | 房间通知文案（合规拦截 / 用量上限 / 需人工确认 / 超时 / 暂不可用） | 渠道回复文案与之同义（§4.5） |

### 1.3 调研语义（`research/managed-agents/`）

| 来源 | 语义 | 采纳 |
|---|---|---|
| `zhipu/channels.md` L30–36 | 飞书应用需启用机器人与消息接收、发布并配置可用范围；`app_id` + `app_secret` | 管理台表单字段 |
| `zhipu/channels.md` L66–76 | 保存成功不代表已连上；查看 `connection_status` 与 `last_error` | `ma_channel_runtime_state` + 详情展示 |
| `zhipu/channels.md` L76 | 关联会话的 metadata 记 `source_type`、`channel_id`、`conversation_type` | 本文放在 `ma_channel_conversations`（会话记录无 metadata 写入口） |
| `zhipu/channels.md` L90 | 不发工具原始结果与 Thinking；最终正文取当轮最后一条非空 `agent.message` | §4.5 |
| `zhipu/channels.md` L103 | 渠道不支持审批接续，`requires_action` 时该条处理失败 | D8：中断并回复说明 |
| `workbuddy/使用说明.md` L253、L267 | 版本策略「跟随最新」（发布新版本后渠道自动生效）与「指定版本」 | D4 |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **配置归管理台、运行状态归运行时**：`ma_channels` 只由 admin-console 写；`ma_channel_conversations`（会话映射）、`ma_channel_inbound`（消息去重）、`ma_channel_runtime_state`（连接状态）只由 agent-runtime 写；管理台只读后者展示 | master §2.3 |
| D2 | **连接跑在企业侧 agent-runtime，不在桌面**；只做飞书**长连接**模式（出站 WebSocket，无需公网回调）。HTTP 回调模式不做 | 私有化机房通常没有可被飞书访问的公网入口；Near 的飞书长连接（`agx feishu`）是个人模式，不纳入 |
| D3 | **app secret 走凭证库**：渠道保存 `credential_vault_id` + `credential_id`，引用一条 `environment_variable` 类型凭证（`secret_value` = app secret；`secret_name` 任意，建议 `FEISHU_APP_SECRET`），**不新增凭证类型、不改 E06 文件**。运行时启动连接前经新内部接口 `POST /api/internal/ma/channels/:id/credential` 取明文，每次调用写 `audit_events`（`ma.channel.credential_resolve`），审计失败不返回密钥 | 满足「Vault 引用、不存明文」；E06 的 `vault-resolve` 要求会话引用，不适用于「还没有会话」的连接建立 |
| D4 | **版本路由**：`routing = follow_latest` → 目标版本 = Agent 的 `latest_version`（registry 10 秒缓存）；`pinned` → `pinned_version`。每条消息到达时若会话映射中的 `agent_version ≠ 目标版本`，**新开会话**（旧会话保留可查），因此「跟随最新」在发布后 ≤ 10 秒生效 | 会话创建即锁版本（master §4 决策 7），切版本只能换会话；10 秒为 registry 缓存上限 |
| D5 | **每个渠道一个子进程**：`python -m ma_agent_runtime.channels.feishu_child`，凭据经 **stdin** 一行 JSON 传入（不进 argv / 环境变量），子进程只负责长连接并把收到的事件以 JSON 行写 stdout；会话逻辑全部在父进程 | 飞书 SDK 模块级事件循环，同进程多连接不可靠；子进程崩溃不影响 agent-runtime |
| D6 | **复用框架网关代码**：父进程用 `FeishuAdapter(app_id, "").process_json(body)` 解析事件为 `GatewayMessage`，用 `md_to_feishu_post` 生成富文本；回复与 tenant token 由本文新写的 `FeishuOpenApi`（httpx，`trust_env=True` 以走企业出站代理）完成 | 不改 `agenticx/gateway/**`；只 import 公共名 |
| D7 | **会话粒度**：私聊 `p2p:<open_id>`、群聊 `chat:<chat_id>`（群内成员共享一个会话，消息正文前加发送人标识）。超过 `idle_reset_hours`（缺省 24）无消息、会话已归档 / 终止、版本不符、或用户发送「新对话」类指令 → 新会话 | 与飞书话题无关；群共享上下文符合「@机器人讨论同一件事」的用法 |
| D8 | **无人值守收尾**：会话进入 `requires_action` → 发 `user.interrupt`，回复「需要人工确认才能继续，IM 渠道暂不支持确认，本次回复已中止」；超过 `MA_RUNTIME_CHANNEL_REPLY_TIMEOUT_SECONDS`（缺省 300）→ 中断并回复超时 | 与门户房间（E04）一致 |
| D9 | **单主连接**：只有持有 PG advisory lock（`pg_try_advisory_lock(hashtext('agx_ma_channels'))`，专用连接常驻）的 agent-runtime 副本运行渠道连接；未持锁的副本每 30 秒重试抢锁 | 同一会话的 actor 在进程内（E03），多副本同时处理同一群的消息会冲突；飞书同一应用多连接也只投递给其一 |
| D10 | **会话身份**：会话 `created_by_user_id = ma_channels.owner_user_id`（创建渠道的管理员，之后不变）；飞书 open_id / chat_id 只记在 `ma_channel_conversations` | 飞书用户与企业账号没有可靠映射；配额（E10）按渠道属主计 |
| D11 | **新增 2 个 PAT scope**：`ma:channels:read`、`ma:channels:write`，插在 E08 新增的 `ma:webhooks:write` 之后、`ma:admin` 之前 | 与其他控制面资源同构。**须在 master §12 登记** |
| D12 | **同一飞书应用只能绑定一个渠道**：唯一索引 `(tenant_id, platform, app_id)` | 一个应用一条长连接；重复绑定会抢消息 |
| D13 | **只处理文本消息**：非文本回复一次「暂只支持文字消息」；群聊里去掉 `@_user_N` 占位符 | v1 范围；附件 / 图片后续 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

**db-schema（TS）**
- 新建 `enterprise/packages/db-schema/drizzle/0066_ma_channels.sql`、`drizzle-mysql/0040_ma_channels.sql`
- 修改两个 `meta/_journal.json`（各追加 1 条）
- 新建 `src/schema/ma-channels.ts`、`src/mysql-schema/ma-channels.ts`；修改两个 `index.ts`（各 1 行）
- 修改 `src/__tests__/migration-inventory.test.ts`、`schema-parity.test.ts`、`ma-schema.test.ts`

**协议常量**
- 修改 `enterprise/packages/core-api/src/managed-agents.ts`、`agenticx/managed/protocol.py`（`PAT_SCOPES` 插入 2 项）、`enterprise/apps/admin-console/src/lib/ma/pat-scope-options.ts`、`docs/managed-agents/protocol.md`（scope 表 2 行）

**iam-core（TS）**
- 新建 `enterprise/packages/iam-core/src/repos/ma-channels.ts`、`src/repos/mysql/ma-channels.ts`
- 修改 `src/index.ts`（1 行 export）
- 新建 `src/repos/__tests__/ma-channels-validate.test.ts`

**admin-console（TS）**
- 修改 `src/lib/ma/errors.ts`（3 码 + 映射）
- 新建 `src/lib/ma/channel-records.ts`
- 新建公共接口 `src/app/api/ma/v1/channels/route.ts`、`channels/[channelId]/route.ts`
- 新建内部接口 `src/app/api/internal/ma/channels/route.ts`、`src/app/api/internal/ma/channels/[channelId]/credential/route.ts`
- 新建管理台接口 `src/app/api/admin/ma-channels/route.ts`、`ma-channels/[channelId]/route.ts`、`ma-channels/[channelId]/conversations/route.ts`（`shared.ts` 从 E08 的 `ma-schedules/shared.ts` import；若 E08 未合入则从 `ma-vaults/shared.ts` import）
- 新建页面 `src/app/admin/_sections/agent-channels.tsx`
- 修改 `src/app/admin/[section]/page.tsx`、`src/lib/admin-platform-sections.ts`、`src/lib/__tests__/admin-platform-sections.test.ts`、`src/components/AppShell.tsx`、`messages/zh.json`、`messages/en.json`
- 新建测试 `src/app/api/ma/v1/__tests__/channels-route.test.ts`、`src/app/api/internal/ma/__tests__/channel-internal-routes.test.ts`

**agent-runtime（Python）**
- 新建包 `enterprise/apps/agent-runtime/ma_agent_runtime/channels/`：`__init__.py`、`feishu_child.py`、`feishu_api.py`、`router.py`、`supervisor.py`
- 修改 `ma_agent_runtime/tables.py`（追加 3 表，新增 `CHANNEL_TABLES`）
- 修改 `ma_agent_runtime/control_plane.py`（`AdminConsoleClient` 追加 2 方法）
- 修改 `ma_agent_runtime/config.py`（`Settings` 追加 6 字段）
- 修改 `ma_agent_runtime/app.py`（`channels_enabled` 时接线）
- 修改 `enterprise/apps/agent-runtime/requirements.txt`（追加 `lark-oapi>=1.3.0,<2`、`setuptools<81`）
- 修改 `enterprise/apps/agent-runtime/README.md`
- 新建测试 `tests/test_channel_router.py`、`tests/test_channel_supervisor.py`、`tests/test_feishu_api.py`、夹具 `tests/fixtures/feishu_message_p2p.json`、`tests/fixtures/feishu_message_group.json`；修改 `tests/test_tables_parity.py`、`tests/fakes.py`

### 3.2 Out of scope

- `agenticx/gateway/**`、`agenticx/studio/**`、Near 的飞书长连接 / 绑定（个人模式不变）。
- 企业微信 / 钉钉 / 个人微信渠道；飞书 HTTP 回调模式；飞书卡片（interactive）输出；流式逐段回复；图片 / 文件消息；话题（thread）粒度会话。
- 飞书用户 → 企业账号的身份映射；渠道私有记忆库自动创建。
- 修改 E06 凭证类型或 `vault-resolve`。

---

## 4. 数据与协议

### 4.1 PG `0066_ma_channels.sql`（逐字）

```sql
-- Managed Agents IM 渠道。ma_channels：唯一写入方 admin-console。
-- ma_channel_conversations / ma_channel_inbound / ma_channel_runtime_state：唯一写入方 agent-runtime。
CREATE TABLE IF NOT EXISTS "ma_channels" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "platform" varchar(16) DEFAULT 'feishu' NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "routing" varchar(16) DEFAULT 'follow_latest' NOT NULL,
  "pinned_version" integer,
  "environment_id" varchar(26),
  "app_id" varchar(64) NOT NULL,
  "credential_vault_id" varchar(26) NOT NULL,
  "credential_id" varchar(26) NOT NULL,
  "owner_user_id" varchar(26) NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channels_tenant_name_uq" ON "ma_channels" ("tenant_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channels_tenant_app_uq" ON "ma_channels" ("tenant_id", "platform", "app_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_conversations" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "channel_id" varchar(26) NOT NULL,
  "conversation_key" varchar(160) NOT NULL,
  "conversation_type" varchar(16) NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "agent_version" integer NOT NULL,
  "last_message_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channel_conversations_key_uq" ON "ma_channel_conversations" ("channel_id", "conversation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_channel_conversations_session_idx" ON "ma_channel_conversations" ("session_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_inbound" (
  "channel_id" varchar(26) NOT NULL,
  "platform_message_id" varchar(128) NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ma_channel_inbound_pk" PRIMARY KEY ("channel_id", "platform_message_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_channel_inbound_received_idx" ON "ma_channel_inbound" ("received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_runtime_state" (
  "channel_id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "revision" integer NOT NULL,
  "status" varchar(16) NOT NULL,
  "last_error" varchar(500),
  "last_event_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

### 4.2 MySQL `0040_ma_channels.sql`（逐字）

```sql
-- Managed Agents IM 渠道（MySQL）。agent-runtime 只支持 PostgreSQL，MySQL 侧仅保持 schema 对齐。
CREATE TABLE IF NOT EXISTS `ma_channels` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(120) NOT NULL,
  `platform` varchar(16) NOT NULL DEFAULT 'feishu',
  `agent_id` varchar(26) NOT NULL,
  `routing` varchar(16) NOT NULL DEFAULT 'follow_latest',
  `pinned_version` int,
  `environment_id` varchar(26),
  `app_id` varchar(64) NOT NULL,
  `credential_vault_id` varchar(26) NOT NULL,
  `credential_id` varchar(26) NOT NULL,
  `owner_user_id` varchar(26) NOT NULL,
  `config` json NOT NULL DEFAULT (JSON_OBJECT()),
  `enabled` boolean NOT NULL DEFAULT true,
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channels_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_channels_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_channels_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_channels_tenant_name_uq` (`tenant_id`, `name`),
  UNIQUE INDEX `ma_channels_tenant_app_uq` (`tenant_id`, `platform`, `app_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_conversations` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `channel_id` varchar(26) NOT NULL,
  `conversation_key` varchar(160) NOT NULL,
  `conversation_type` varchar(16) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `agent_version` int NOT NULL,
  `last_message_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_conversations_id` PRIMARY KEY (`id`),
  UNIQUE INDEX `ma_channel_conversations_key_uq` (`channel_id`, `conversation_key`),
  INDEX `ma_channel_conversations_session_idx` (`session_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_inbound` (
  `channel_id` varchar(26) NOT NULL,
  `platform_message_id` varchar(128) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `received_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_inbound_pk` PRIMARY KEY (`channel_id`, `platform_message_id`),
  INDEX `ma_channel_inbound_received_idx` (`received_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_runtime_state` (
  `channel_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `revision` int NOT NULL,
  `status` varchar(16) NOT NULL,
  `last_error` varchar(500),
  `last_event_at` datetime(6),
  `started_at` datetime(6),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_runtime_state_id` PRIMARY KEY (`channel_id`)
);
```

Journal：PG `{"idx": 65, "version": "7", "when": 1788400000000, "tag": "0066_ma_channels", "breakpoints": true}`；MySQL `{"idx": 40, "version": "5", "when": 1788400000001, "tag": "0040_ma_channels", "breakpoints": true}`（`idx` 以实际末项 +1）。`ma_channel_inbound` 是复合主键：若 `schema-parity.test.ts` 的解析器不支持复合主键约束，按它对 `0035_ma_control_plane.sql` 的处理方式调整解析（实施前先跑一遍测试看报错）。

### 4.3 `ma_channels.config`（jsonb，管理台校验，未知键拒绝）

```json
{ "idle_reset_hours": 24, "open_base_url": "https://open.feishu.cn" }
```

- `idle_reset_hours`：1–720，缺省 24。
- `open_base_url`：`https://open.feishu.cn`（缺省）或 `https://open.larksuite.com`；只允许这两个值（防 SSRF）。

### 4.4 Channel 记录（`toMaChannelRecord`，恰为下列键）

```json
{
  "id": "01J…", "tenant_id": "01J…", "name": "项目助理", "platform": "feishu",
  "agent_id": "01J…", "routing": "follow_latest", "pinned_version": null, "environment_id": null,
  "app_id": "cli_a1b2c3", "credential": { "vault_id": "01J…", "credential_id": "01J…" },
  "owner_user_id": "01J…", "config": { "idle_reset_hours": 24, "open_base_url": "https://open.feishu.cn" },
  "enabled": true, "revision": 2,
  "connection": { "status": "running", "last_error": null, "last_event_at": "…", "started_at": "…" },
  "created_at": "…", "updated_at": "…"
}
```

`connection` 来自 `ma_channel_runtime_state`（无行时 `{"status":"pending","last_error":null,"last_event_at":null,"started_at":null}`；行的 `revision` 小于渠道 `revision` 时 `status` 显示 `pending`）。`status` ∈ `pending|starting|running|error|stopped`。

**创建 / 更新请求体**（`assertOnlyKeys`）：`name`（1–120，租户内唯一）、`platform?`（只允许 `"feishu"`）、`agent_id`（ULID，存在于本租户）、`routing?`（缺省 `follow_latest`）、`pinned_version?`（`pinned` 时必填且版本存在；否则必须为 null / 省略）、`environment_id?`（ULID 或 null；非 null 时须存在且 active）、`app_id`（`^cli_[A-Za-z0-9]{6,60}$`；租户内唯一）、`credential`（`{vault_id, credential_id}`；凭证须存在、`status='active'`、`type='environment_variable'`、所属 Vault `status='active'`）、`config?`、`enabled?`。`owner_user_id` 不可提交（创建时 = 调用者，之后不变）。任一字段变化 → `revision + 1`。每租户 ≤ 20 个渠道（409 `channel_limit`）。`app_id` 创建后不可改（改 → 400 `app_id: is immutable`）。

### 4.5 渠道消息处理（agent-runtime，`router.py`）

输入：`GatewayMessage`（`FeishuAdapter.process_json` 的结果）+ `chat_type = raw["event"]["message"].get("chat_type")`（`"p2p"` 或 `"group"`）。

```text
if msg is None or not msg.message_id: drop
INSERT ma_channel_inbound (channel_id, message_id) ON CONFLICT DO NOTHING -> 0 rows: drop (duplicate delivery)
if msg.content_type != "text": reply "暂只支持文字消息"; return
text = re.sub(r"@_user_\d+", "", msg.content).strip(); if not text: return
key = f"p2p:{msg.sender_id}" if chat_type != "group" else f"chat:{msg.chat_id}"
async with conversation_lock(channel.id, key):          # one turn per conversation at a time
    if text.lower() in NEW_CHAT_COMMANDS: DELETE mapping; reply "已开始新对话。"; return
    agent = await registry.get_agent(tenant, channel.agent_id)
    if agent is None or agent.status != "active" or agent.lifecycle != "published": reply notices.unpublished; return
    target = agent.latest_version if channel.routing == "follow_latest" else channel.pinned_version
    mapping = SELECT ... WHERE channel_id AND conversation_key
    session = await service.store.get_session(tenant, mapping.session_id) if mapping else None
    reuse = (mapping and session and session.status not in ("archived", "terminated")
             and mapping.agent_version == target
             and now - mapping.last_message_at <= idle_reset_hours)
    if not reuse:
        record = await service.create_session(principal, CreateSessionRequest(agent_id=channel.agent_id, agent_version=target,
                   environment_id=channel.environment_id, title=title_for(chat_type, key), source="channel"))
        UPSERT mapping (conversation_key, conversation_type=chat_type or "p2p", session_id=record.id, agent_version=record.agent_version)
        session_id = record.id
    cursor = await service.store.last_seq(tenant, session_id)
    body = text if chat_type != "group" else f"{short_sender(msg.sender_id)}：{text}"
    await service.post_events(principal, session_id, {"events": [{"type": "user.message", "content": [{"type": "text", "text": body}]}]})
    UPDATE mapping SET last_message_at=now
    outcome = await wait_for_idle(session_id, after_seq=cursor, timeout=settings.channel_reply_timeout_seconds)
    reply_text = outcome.final_text or notice_for(outcome)
    await api.reply(message_id=msg.message_id, text=reply_text)
```

- `principal = Principal(tenant_id=channel.tenant_id, user_id=channel.owner_user_id, scopes=frozenset({"ma:sessions:read","ma:sessions:write"}))`。
- `NEW_CHAT_COMMANDS = frozenset({"新对话", "new chat", "/new", "/reset", "重置", "清空上下文"})`（与 `feishu_longconn._is_new_chat` 同集合）。
- `title_for`：`"飞书 · 私聊 " + key[-6:]` 或 `"飞书 · 群聊 " + key[-6:]`（≤ 200）；`short_sender(open_id) = "成员" + open_id[-4:]`。
- `wait_for_idle`：每 1.0 秒 `service.store.list_events(tenant, session_id, after_seq=cursor, limit=100)` 拉增量并推进游标；遇到 `session.status_idle`：`stop_reason.type == "requires_action"` → 发 `user.interrupt`（只发一次）并记 `needs_confirmation=True`，继续等下一个 idle；其他 → 结束。超时 → 发 `user.interrupt`，`outcome.timed_out=True`。`final_text` = 收集到的最后一条 `agent.message` 的 `type=="text"` 块以 `\n` 连接后 `strip()`。
- `notice_for(outcome)`（优先级自上而下）：`needs_confirmation` → `需要人工确认才能继续，IM 渠道暂不支持确认，本次回复已中止`；`timed_out` → `处理超时，请稍后再试`；`stop == "policy_blocked"` → `请求触发合规拦截`；`stop == "budget_exceeded"` → `本次用量已达上限，请联系管理员`；其他 → `暂时不可用，请稍后再试`。`notices.unpublished = "该智能体暂未发布，请联系管理员"`。
- `create_session` / `post_events` 抛 `MAError` → 回复 `暂时不可用，请稍后再试` 并 `logger.warning("channel turn failed channel=%s code=%s", ...)`（不记消息内容）。
- 并发：全局 `asyncio.Semaphore(settings.channel_max_concurrency)`（缺省 8）包住整段处理；`conversation_lock` 为 `dict[(channel_id, key)] -> asyncio.Lock`（用完不删，量小）。
- `ma_channel_inbound` 清理：supervisor 每小时 `DELETE WHERE received_at < now - 7 days`。

### 4.6 飞书接口（`feishu_api.py`）

```text
POST {open_base_url}/open-apis/auth/v3/tenant_access_token/internal   body {"app_id","app_secret"} -> {"code":0,"tenant_access_token","expire"}
POST {open_base_url}/open-apis/im/v1/messages/{message_id}/reply      header Authorization: Bearer <token>
     body {"msg_type":"post","content": json.dumps(md_to_feishu_post(text[:4000]), ensure_ascii=False)}
     -> {"code":0,...}; code != 0 or HTTP >= 400 -> retry once with {"msg_type":"text","content": json.dumps({"text": text[:4000]}, ensure_ascii=False)}
```

token 缓存到 `expire - 60` 秒；HTTP 401 或 `code` ∈ `{99991663, 99991664, 99991668}`（token 失效类，实施时以飞书文档为准）→ 清缓存重取一次。`httpx.AsyncClient(timeout=20.0, trust_env=True)`。日志只记 `code` 与 HTTP 状态，不记 token、正文。

### 4.7 内部接口（admin-console，`isMaInternalAuthorized`，`cache-control: no-store`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/internal/ma/channels` | — | `{data:[{id, tenant_id, name, platform, agent_id, routing, pinned_version, environment_id, app_id, owner_user_id, config, revision}]}`：全部租户 `enabled=true`（不含凭证引用） |
| POST | `/api/internal/ma/channels/:id/credential` | `{"tenant_id":"<id>"}` | 200 `{"app_id":"cli_…","app_secret":"…"}`；渠道不存在或停用 → 404 `channel_not_found`；凭证不存在 / 非 active / 类型不对 / Vault 已归档 → 409 `channel_credential_unavailable`；主密钥缺失 → 503 `vault_crypto_unavailable` |

`credential` 接口：先在同一请求内 `insertAuditEvent({tenantId, actorUserId: null, eventType: "ma.channel.credential_resolve", targetKind: "ma_channel", targetId: channelId, detail: {vault_id, credential_id}})`，**审计写入失败 → 500 且不返回密钥**；再 `openSecretPayload(...)` 取 `secret_value`。`targetKind` 长度 ≤ 32（`ma_channel` 满足）。

### 4.8 公共 / 管理台接口

| 方法 | 路径 | scope / 管理台权限 | 响应 |
|---|---|---|---|
| GET | `/api/ma/v1/channels?agent_id=` | `ma:channels:read` | `{data:[Channel]}` |
| POST | `/api/ma/v1/channels` | `ma:channels:write` | 201 `{channel}` |
| GET / PATCH / DELETE | `/api/ma/v1/channels/:id` | read / write / write | `{channel}` / `{channel}` / `{deleted:true}` |
| GET / POST | `/api/admin/ma-channels` | `provider:read` / `provider:update` | `{code:"00000",message:"ok",data:{channels}}` / `{…data:{channel}}` |
| GET / PATCH / DELETE | `/api/admin/ma-channels/:id` | `provider:read` / `provider:update` / `provider:delete` | 同上 |
| GET | `/api/admin/ma-channels/:id/conversations?limit=` | `provider:read` | `{…data:{conversations:[{conversation_key, conversation_type, session_id, agent_version, last_message_at}]}}`（`limit` 1–200，缺省 50，`last_message_at` 倒序） |

### 4.9 错误码（admin-console `MA_CONTROL_PLANE_ERROR_CODES` 追加，须在 master §12 登记）

| 码 | HTTP | 异常类名 | 消息 |
|---|---|---|---|
| `channel_not_found` | 404 | `MaChannelNotFoundError` | `channel not found` |
| `channel_limit` | 409 | `MaChannelLimitError` | `a tenant can hold at most 20 channels` |
| `channel_credential_unavailable` | 409 | `MaChannelCredentialUnavailableError` | `channel credential is unavailable` |

`MaChannelValidationError` → `invalid_request`；名称或 `app_id` 冲突 → `MaChannelConflictError` → `invalid_request`（消息 `name already exists` 或 `app_id is already bound to another channel`）。

---

## 5. 精确落点

### 5.1 iam-core `src/repos/ma-channels.ts`（新建，照抄 `ma-environments.ts` 结构）

```ts
export type MaChannelRouting = "follow_latest" | "pinned";
export type MaChannel = { id; tenantId; name; platform: "feishu"; agentId; routing: MaChannelRouting; pinnedVersion: number | null; environmentId: string | null; appId; credentialVaultId; credentialId; ownerUserId; config: { idle_reset_hours: number; open_base_url: string }; enabled: boolean; revision: number; createdBy: string | null; createdAt; updatedAt };
export type MaChannelConnection = { status: "pending" | "starting" | "running" | "error" | "stopped"; lastError: string | null; lastEventAt: string | null; startedAt: string | null };
export class MaChannelValidationError / MaChannelNotFoundError / MaChannelConflictError / MaChannelLimitError / MaChannelCredentialUnavailableError extends Error {}  // 各自设置 name
export function normalizeChannelInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedChannelInput;   // 纯函数，§4.3 / §4.4
export async function listMaChannels(tenantId: string, filter?: { agentId?: string }): Promise<Array<MaChannel & { connection: MaChannelConnection }>>;
export async function getMaChannel(tenantId: string, id: string): Promise<MaChannel & { connection: MaChannelConnection }>;
export async function createMaChannel(tenantId: string, body: Record<string, unknown>, actorUserId: string): Promise<MaChannel>;
export async function updateMaChannel(tenantId: string, id: string, body: Record<string, unknown>): Promise<MaChannel>;
export async function deleteMaChannel(tenantId: string, id: string): Promise<void>;
export async function listEnabledMaChannelsForRuntime(): Promise<MaChannel[]>;
export async function resolveMaChannelAppSecret(tenantId: string, channelId: string): Promise<{ appId: string; appSecret: string }>;  // §4.7，含审计
export async function listMaChannelConversations(tenantId: string, channelId: string, limit: number): Promise<MaChannelConversation[]>;
```

`createMaChannel` / `updateMaChannel` 的凭证校验与 `resolveMaChannelAppSecret` 共用私有函数 `loadChannelCredential(tenantId, vaultId, credentialId)`：用 drizzle 只读查询 `ma_credentials` 与 `ma_vaults`（`@agenticx/db-schema` 的 `maCredentials`、`maVaults`），返回 `{ type, status, vaultStatus, sealed }`；类型不是 `environment_variable` 或任一状态非 `active` → 校验时抛 `MaChannelValidationError("credential: must reference an active environment_variable credential")`，解析时抛 `MaChannelCredentialUnavailableError`。解密：`openSecretPayload({ ciphertext: row.secretCiphertext, wrappedDek: row.wrappedDek, kekId: row.kekId }).secret_value`（`secret_value` 字段名以 E06 实际为准：`rg -n "secret_value" enterprise/packages/iam-core/src/repos/ma-vault-validate.ts`）。

### 5.2 admin-console

- `errors.ts`：追加 §4.9 三码与 5 个异常名映射；现有分支不动。
- `channel-records.ts`：`toMaChannelRecord(channel)` 输出 §4.4 恰好键。
- 路由按 E08 §5.5 同样的样板实现 §4.7 / §4.8。
- 页面 `agent-channels.tsx`（`useTranslations("pages.admin.agentChannels")`）：
  - 表格列：名称、智能体、版本策略（「跟随最新」/「固定 vN」）、飞书应用 ID、连接状态（徽标：待连接 / 连接中 / 已连接 / 异常 / 已停止；异常时 hover 显示 `last_error`）、启用开关、操作（编辑 / 会话 / 删除）。
  - 新建 / 编辑弹窗：名称、智能体（下拉）、版本策略（单选 + 固定版本号）、执行环境（可空）、飞书应用 ID、应用密钥（两个下拉：凭证库 → 该库内 `environment_variable` 类型凭证；数据来自 `/api/admin/ma-vaults` 与 `/api/admin/ma-vaults/:id/credentials`）、站点（飞书 / Lark 国际版）、空闲多久后开新会话（小时）。底部「取消」紧邻「保存」左侧；保存失败保留弹窗显示错误文本。
  - 会话抽屉：最近 50 条映射（类型「私聊 / 群聊」、会话链接 `/ops/logs/managed/<session_id>`、版本、最后消息时间）。
  - 删除：主题化确认弹窗，文案「删除后机器人不再回复，已产生的会话保留」。
- 注册：`admin-platform-sections.ts` 在 E08 两项之后插入 `"agent-channels"`；`[section]/page.tsx` 两行；`AppShell.tsx` 加 `{ href: "/admin/agent-channels", labelKey: "agentChannels", icon: MessagesSquare }`；文案 zh `agentChannels: "IM 渠道"`、en `"IM Channels"`。

### 5.3 agent-runtime `channels/feishu_child.py`（新建）

```python
#!/usr/bin/env python3
"""Child process: hold one Feishu long connection and print events as JSON lines.

Protocol: one JSON line on stdin {"app_id","app_secret","domain"}; then stdout lines
{"kind":"event","body":<event dict>} for each im.message.receive_v1 event.
Logs go to stderr only.

Author: Damon Li
"""

import json
import logging
import sys

import lark_oapi as lark


def main() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    cfg = json.loads(sys.stdin.readline())
    def on_message(data) -> None:
        body = json.loads(lark.JSON.marshal(data))
        sys.stdout.write(json.dumps({"kind": "event", "body": body}, ensure_ascii=False) + "\n"); sys.stdout.flush()
    handler = lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(on_message).build()
    lark.ws.Client(cfg["app_id"], cfg["app_secret"], event_handler=handler, domain=cfg["domain"], log_level=lark.LogLevel.INFO).start()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

（`lark_oapi` 在文件顶部导入：父进程**从不** import `feishu_child`（只以 `-m` 启动子进程），`channels/__init__.py` 也不得导入它，因此父进程不会加载该 SDK。测试先 `monkeypatch.setitem(sys.modules, "lark_oapi", fake)` 再 `importlib.import_module`。`cfg` 不写日志。）

### 5.4 `channels/feishu_api.py`（新建）

```python
class FeishuOpenApi:
    def __init__(self, *, app_id: str, app_secret: str, base_url: str, http: httpx.AsyncClient | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    async def reply(self, *, message_id: str, text: str) -> bool: ...   # §4.6; returns True on success
    async def aclose(self) -> None: ...
    def __repr__(self) -> str: ...                                     # never includes the secret
```

### 5.5 `channels/router.py`（新建）

```python
NEW_CHAT_COMMANDS = frozenset({...})            # §4.5
NOTICES = {...}                                 # §4.5 texts

@dataclass(frozen=True)
class ChannelConfig: id; tenant_id; name; agent_id; routing; pinned_version; environment_id; app_id; owner_user_id; idle_reset_hours: float; open_base_url: str; revision: int

@dataclass
class TurnOutcome: final_text: str; stop_type: str | None; needs_confirmation: bool; timed_out: bool

class ChannelRouter:
    def __init__(self, *, engine: AsyncEngine, service: SessionService, registry: AgentRegistry, settings: Settings,
                 clock: Callable[[], datetime] = utc_now, poll_seconds: float = 1.0) -> None: ...
    async def handle_event(self, channel: ChannelConfig, body: dict[str, Any], api: FeishuOpenApi) -> None: ...  # §4.5
    async def wait_for_idle(self, principal: Principal, tenant_id: str, session_id: str, *, after_seq: int, timeout: float) -> TurnOutcome: ...
```

`handle_event` 第一步：`_, msg = FeishuAdapter(channel.app_id, "").process_json(body)`（`FeishuAdapter` 从 `agenticx.gateway.adapters.feishu` 导入；空 `app_secret` 不影响解析）。

### 5.6 `channels/supervisor.py`（新建）

```python
class ChannelSupervisor:
    def __init__(self, *, engine: AsyncEngine, sync_engine: Engine, client: AdminConsoleClient, router: ChannelRouter,
                 settings: Settings, spawn: Callable[..., Awaitable[ChildHandle]] | None = None, clock=utc_now) -> None: ...
    async def run_forever(self) -> None: ...      # leader loop
    async def reconcile(self) -> None: ...        # one pass (tests call this directly)
    async def shutdown(self) -> None: ...         # terminate children, release the advisory lock
```

- **抢锁**：`run_forever` 循环：若未持锁，`await asyncio.to_thread(self._try_lock)`——在专用同步连接上 `SELECT pg_try_advisory_lock(hashtext('agx_ma_channels'))`（该连接保持打开直到 `shutdown`）；失败则 `sleep(30)` 重试。持锁后每 `settings.channel_reconcile_seconds`（缺省 30）调用 `reconcile()`。SQLite 测试库：`_try_lock` 直接返回 True。
- **`reconcile()`**：`channels = await client.list_runtime_channels()`；对每个渠道：若无子进程或子进程 `revision` 不同 → 停旧的、`await self._start(channel)`；子进程已退出 → 按退避（5、10、20、40…上限 300 秒）重启；不在列表中的子进程 → 终止并写 `ma_channel_runtime_state.status='stopped'`。每小时清理一次 `ma_channel_inbound`（§4.5）。
- **`_start(channel)`**：写状态 `starting`（UPSERT runtime_state：`revision`、`status`、`started_at=now`、`last_error=null`）；`creds = await client.resolve_channel_credential(channel.tenant_id, channel.id)`（`MAError` → 状态 `error`、`last_error` = 错误码，进入退避）；`handle = await spawn(creds, domain)`：缺省实现 `asyncio.create_subprocess_exec(sys.executable, "-m", "ma_agent_runtime.channels.feishu_child", stdin=PIPE, stdout=PIPE, stderr=PIPE, env=<os.environ 副本，删除 SECRET_ENV_RE 匹配项>)`，写入一行 `{"app_id","app_secret","domain": channel.open_base_url}` 后关闭 stdin；`api = FeishuOpenApi(app_id, app_secret, base_url=channel.open_base_url)`；创建读循环任务：逐行解析 stdout，`kind=="event"` → 更新 `last_event_at`，`asyncio.create_task(router.handle_event(channel, line["body"], api))`；子进程存活 5 秒后状态置 `running`。stderr 最后 20 行保留在内存；退出时 `last_error = "exited <code>: " + redact(tail)[:400]`（`redact` = 删掉任何与 `app_secret` 相同的子串）。
- `ChildHandle`：`{process, revision, reader_task, api, started_monotonic}`；测试注入 `spawn` 返回假句柄（§6.1）。

### 5.7 `tables.py`（追加 3 表，`CHANNEL_TABLES = (ma_channel_conversations, ma_channel_inbound, ma_channel_runtime_state)`；`MANAGED_TABLES` 不变）

列与 §4.1 一一对应；`ma_channel_inbound` 用 `PrimaryKeyConstraint("channel_id", "platform_message_id", name="ma_channel_inbound_pk")`。

### 5.8 `control_plane.py`（只追加）

```python
async def list_runtime_channels(self) -> list[dict[str, Any]]:
    body = await self._read("GET", "/api/internal/ma/channels", allow_404=False); return list((body or {}).get("data") or [])
async def resolve_channel_credential(self, tenant_id: str, channel_id: str) -> dict[str, str]:
    body = await self._read("POST", f"/api/internal/ma/channels/{channel_id}/credential", allow_404=True, json={"tenant_id": tenant_id})
    if body is None: raise MAError(INTERNAL, "channel not found")
    return {"app_id": str(body["app_id"]), "app_secret": str(body["app_secret"])}
```

注意 `_read` 对 409 / 503 一律抛 `MAError(INTERNAL, "control plane unavailable")`——supervisor 把它记为 `last_error='credential_unavailable'`（不区分细因，管理台详情可看凭证状态）。

### 5.9 `config.py`（`Settings` 追加）

| 字段 | 环境变量 | 默认 | 解析 |
|---|---|---|---|
| `channels_enabled: bool` | `MA_RUNTIME_CHANNELS_ENABLED` | False | `== "1"` |
| `channel_reply_timeout_seconds: float` | `MA_RUNTIME_CHANNEL_REPLY_TIMEOUT_SECONDS` | 300.0 | 10–1800，非法回退 |
| `channel_max_concurrency: int` | `MA_RUNTIME_CHANNEL_MAX_CONCURRENCY` | 8 | `_int_ok` 1–64 |
| `channel_reconcile_seconds: float` | `MA_RUNTIME_CHANNEL_RECONCILE_SECONDS` | 30.0 | 5–300，非法回退 |
| `channel_poll_seconds: float` | `MA_RUNTIME_CHANNEL_POLL_SECONDS` | 1.0 | 0.2–10，非法回退 |
| `channel_inbound_retention_days: int` | `MA_RUNTIME_CHANNEL_INBOUND_RETENTION_DAYS` | 7 | `_int_ok` 1–90 |

### 5.10 `app.py`（追加，放在 `wire_worker_plane` 判断之后）

```python
if settings.channels_enabled:
    router = ChannelRouter(engine=async_engine, service=app.state.ma.service, registry=registry, settings=settings,
                           poll_seconds=settings.channel_poll_seconds)
    supervisor = ChannelSupervisor(engine=async_engine, sync_engine=sync_engine, client=client, router=router, settings=settings)
    app.state.ma.extras["channel_supervisor"] = supervisor
    # startup: create_task(supervisor.run_forever()); shutdown: await supervisor.shutdown() then cancel the task
```

若 E08 已提供 `_add_background(app, name, coro_fn)`，直接用它并在其 shutdown 钩子前先 `await supervisor.shutdown()`；否则在本文件内按 E08 §5.14 的描述实现同名私有函数（只实现一次）。

### 5.11 依赖

`enterprise/apps/agent-runtime/requirements.txt` 追加两行：

```text
lark-oapi>=1.3.0,<2
setuptools<81
```

（本机 SDK 的 `lark_oapi/ws/pb/google/__init__.py` 依赖 `pkg_resources`，`setuptools>=81` 会移除它；镜像构建后跑 `python -c "import lark_oapi.ws"` 验证。）

---

## 6. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 表结构 | `ma-schema.test.ts` 四表 PG / MySQL 列一致；`schema-parity.test.ts::mirrors all 92 PostgreSQL tables in MySQL`（以实际 +4）；journal 末 tag `0066_ma_channels`；`agent-runtime/tests/test_tables_parity.py::test_channel_tables_match_ddl` |
| FR-2 | 渠道校验 | `ma-channels-validate.test.ts`：`app_id: "abc"` → `app_id: is invalid`；`routing: "pinned"` 无 `pinned_version` → 报错；`config.open_base_url: "https://evil.example.com"` → 报错；`config.extra: 1` → `config.extra: is not allowed`；`owner_user_id` 出现 → 报错；update 改 `app_id` → `app_id: is immutable` |
| FR-3 | 公共接口 | `channels-route.test.ts`：无 scope 403；创建 201，`owner_user_id === PAT 属主`、`connection.status === "pending"`；引用 `static_bearer` 凭证 → 400；同租户重复 `app_id` → 400 `app_id is already bound to another channel`；第 21 个 → 409 `channel_limit`；响应 / 列表任何位置不含 `app_secret` 或 `secret_value`（`JSON.stringify` 断言） |
| FR-4 | 内部凭证解析与审计 | `channel-internal-routes.test.ts`：错误 token 401；正常 → `{app_id, app_secret}` 且 `insertAuditEvent` 恰被调用 1 次，`eventType === "ma.channel.credential_resolve"`、`detail` 不含密钥；`insertAuditEvent` 抛错 → 500 且响应体不含 `app_secret`；凭证已归档 → 409 `channel_credential_unavailable`；渠道停用 → 404 |
| FR-5 | 新会话与续接 | `test_channel_router.py`（§6.1 替身）：`test_first_message_creates_session`：私聊首条 → `create_session` 1 次，`source == "channel"`、`agent_version == agent.latest_version`、`principal.user_id == owner_user_id`；映射行 `conversation_key == "p2p:ou_x"`；回复正文 == 替身会话的 `agent.message` 文本。`test_second_message_reuses_session`：再来一条 → 不建会话，`post_events` 打到同一 session |
| FR-6 | 群聊 | `test_group_message_uses_chat_key_and_prefix`：`chat_type: "group"`、`content: "@_user_1 帮我总结"` → 映射键 `chat:oc_x`，发给会话的文本 == `"成员<open_id 末4位>：帮我总结"` |
| FR-7 | 去重 | `test_duplicate_message_id_is_dropped`：同一 `message_id` 两次 `handle_event` → `post_events` 1 次、回复 1 次 |
| FR-8 | 新对话与过期 | `test_new_chat_command_resets`：发 `/new` → 映射被删、回复 `已开始新对话。`，下一条建新会话；`test_idle_reset`：`last_message_at` 早于 25 小时 → 建新会话 |
| FR-9 | 版本路由 | `test_follow_latest_switches_on_publish`：registry 替身 `latest_version` 从 2 改为 3 后下一条 → 新会话 `agent_version == 3`，映射更新；`test_pinned_stays`：`routing="pinned", pinned_version=2`，`latest_version` 变 3 → 不建新会话、仍用 v2 会话 |
| FR-10 | 收尾通知 | `test_requires_action_interrupts`：会话先给 `status_idle{requires_action}` → `post_events` 收到 `user.interrupt` 1 次，再给 `status_idle{end_turn}` 无文本 → 回复 `需要人工确认才能继续，IM 渠道暂不支持确认，本次回复已中止`；参数化 `policy_blocked` / `budget_exceeded` / `retries_exhausted` 的无文本收尾 → 对应文案；`test_timeout_interrupts`：`timeout=0.2` 且无 idle → 中断 + `处理超时，请稍后再试` |
| FR-11 | 未发布 / 非文本 | `test_unpublished_agent_notice`：`lifecycle="draft"` → 回复 `该智能体暂未发布，请联系管理员`，不建会话；`test_non_text_notice`：`message_type: "image"` → 回复 `暂只支持文字消息` |
| FR-12 | 飞书回复 | `test_feishu_api.py`（`httpx.MockTransport`）：`test_reply_posts_rich_text`：先请求 token 接口（body 含 `app_id`），再 `POST /open-apis/im/v1/messages/om_1/reply`，`msg_type == "post"`、`json.loads(content)` 含 `zh_cn`；`test_falls_back_to_text`：post 返回 `{"code":230001}` → 第二次请求 `msg_type == "text"`；`test_token_cached`：两次 reply 只取 1 次 token；`test_repr_hides_secret`：`"sec" not in repr(api)` |
| FR-13 | 监管进程 | `test_channel_supervisor.py`：注入假 `spawn`（返回可控的事件队列与退出码）：`test_starts_child_and_marks_running`：一次 `reconcile` 后 runtime_state `status ∈ {"starting","running"}`、`revision` 与渠道一致；假子进程推一条事件 → `router.handle_event` 被调用；`test_restarts_on_revision_change`：渠道 `revision` 变 → 旧句柄被终止、新句柄启动；`test_stops_removed_channels`：列表移除 → `status == "stopped"`；`test_credential_failure_sets_error`：`resolve_channel_credential` 抛 `MAError` → `status == "error"`、`last_error == "credential_unavailable"`；`test_stderr_tail_redacts_secret`：子进程退出且 stderr 含密钥 → `last_error` 不含密钥 |
| FR-14 | 子进程协议 | `test_channel_supervisor.py::test_child_reads_config_from_stdin`：用 `monkeypatch` 把 `lark_oapi` 替换为假模块（`sys.modules`），直接调用 `feishu_child.main()`，stdin 给一行配置 → 假 `ws.Client` 收到 `app_id`、`domain`；假 handler 回调一次后 stdout 恰有一行 `{"kind":"event",...}` |
| FR-15 | 开关关闭零影响 | `tests/test_app_e2e.py` 不改一行仍全绿；`build_app(... channels_enabled=False)` 后 `extras` 无 `channel_supervisor` |
| FR-16 | scope 同步 | `tests/managed/test_fixture_parity.py`、`pat-scope-options.test.ts` 全绿；`PAT_SCOPES` 长度 19 |
| NFR-1 | 不泄露 | `caplog` 断言：路由与监管日志不含 `app_secret` 值、不含用户消息正文；`ma_channel_runtime_state.last_error` 不含密钥 |
| NFR-2 | 框架零改动 | `git diff --name-only -- agenticx` 只出现 `agenticx/managed/protocol.py` |
| NFR-3 | 类型 | 涉及包 `typecheck` 无错 |

### 6.1 测试替身约定

- DB：`sqlite_urls` fixture + `tables.metadata.create_all`。
- `service` 替身 `FakeSessions`：`create_session` 返回递增 ULID 的 `SessionRecord`（`agent_version` 取请求值）；`post_events` 记录调用并按测试脚本向 `FakeStore` 追加事件（脚本：每收到 `user.message` 追加 `[session.status_running, agent.message{text}, session.status_idle{end_turn}]`，可被测试替换）；`store.get_session` / `last_seq` / `list_events` 读 `FakeStore`。
- `registry` 替身：`get_agent` 返回可变的 `AgentRecord`。
- `FeishuOpenApi` 替身：记录 `reply(message_id, text)`。
- 飞书事件夹具：`tests/fixtures/feishu_message_p2p.json`、`feishu_message_group.json`（`{"schema":"2.0","header":{"event_type":"im.message.receive_v1",...},"event":{"sender":{"sender_id":{"open_id":"ou_x"}},"message":{"message_id":"om_1","chat_id":"oc_x","chat_type":"p2p","message_type":"text","content":"{\"text\":\"你好\"}"}}}`），放在 `enterprise/apps/agent-runtime/tests/fixtures/`（新建目录，In scope）。

---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
python -m pytest tests/managed -q --no-cov
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
cd enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/db-schema test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/iam-core test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/admin-console test
pnpm --filter @agenticx/iam-core typecheck && pnpm --filter @agenticx/admin-console typecheck && pnpm --filter @agenticx/admin-console build
docker build -f apps/agent-runtime/Dockerfile -t agx-agent-runtime:dev .. && docker run --rm agx-agent-runtime:dev python -c "import lark_oapi.ws; print('ok')"
```

**W5 门演示（渠道部分；需一个测试用飞书自建应用，已开启机器人、事件订阅方式选「长连接」、订阅 `im.message.receive_v1`、发布）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
MA_RUNTIME_CHANNELS_ENABLED=1 bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 1) 管理台 → 凭证库：新建「飞书应用」库，添加 environment_variable 凭证 secret_name=FEISHU_APP_SECRET、值=应用密钥
# 2) 管理台 → IM 渠道：新建，智能体选已发布 Agent（当前 v1），版本策略「跟随最新」，填应用 ID、选上一步凭证；保存后连接状态 ≤ 30 秒变「已连接」
# 3) 飞书私聊机器人「你是哪个版本？」→ 收到回复；会话抽屉出现 p2p 映射，版本 1
# 4) 管理台给该 Agent 发布 v2（改系统提示让它自报 v2）；≥ 10 秒后再私聊 → 回复体现 v2，会话抽屉映射换成新会话、版本 2
# 5) 渠道改「固定版本 v1」保存（revision 变化 → 连接重启）；再私聊 → 新会话 v1；再发布 v3 → 仍为 v1
```

---

## 8. 回滚

- agent-runtime：`MA_RUNTIME_CHANNELS_ENABLED=0`（缺省）→ 不起监管与子进程，行为与 E03/E08 一致。已建会话保留。
- admin-console：页面 / 接口无人调用即无影响；迁移只新增表。
- 代码：删除 §3.1 新建文件，`git checkout` 修改文件；scope 回滚须三处同时还原。

## 9. 不变量

1. `agenticx/gateway/**` 与 Near 个人模式的飞书长连接、绑定文件 `~/.agenticx/feishu_binding.json` 完全不变。
2. 飞书应用密钥明文只出现在：内部解析接口响应、agent-runtime 内存、子进程 stdin。不进数据库明文列、日志、渠道记录、进程参数或子进程环境变量。
3. `ma_channels` 只由 admin-console 写；三张运行时表只由 agent-runtime 写。
4. 渠道会话一律 `source="channel"`，`created_by_user_id` = 渠道属主。
5. E06 的凭证类型、`vault-resolve` 行为不变。

## 10. 风险与待确认

1. **群聊共享会话**（D7）：群内多人同时 @ 会排队（每会话一次一轮），且上下文共享。是否需要「群内按人分会话」（Q1）。
2. **仅长连接**（D2）：若客户只允许飞书 HTTP 回调，需另起子规划（Q2）。
3. **单主连接**（D9）：渠道吞吐受单副本限制；`channel_max_concurrency` 缺省 8。
4. **凭证复用风险**：渠道引用的 `environment_variable` 凭证若所在 Vault 也被会话的 `vault_ids` 引用，A06 会把它作为占位环境变量注入沙箱（只在 `allowed_hosts` 内替换）。管理台在渠道表单提示「建议单独建库」不写长说明，只在凭证下拉旁显示库名；文档（README）写明。
5. **飞书 SDK 依赖**：`lark-oapi` 依赖 `pkg_resources`，需钉 `setuptools<81`；SDK 升级时回归 FR-14 与镜像检查。
6. **配额归属**：渠道会话按属主计入 MA-E10 的用户 × Agent 配额；大量 IM 用户共用一个属主额度（Q3：是否需要「渠道级配额」）。

## 11. 需要在 master §12 登记的事项

- PAT scope 新增 `ma:channels:read`、`ma:channels:write`。
- 控制面扩展错误码 `channel_not_found` 404、`channel_limit` 409、`channel_credential_unavailable` 409。
- 渠道应用密钥以 Vault `environment_variable` 凭证引用存放；新增内部接口 `POST /api/internal/ma/channels/:id/credential`（不经会话引用校验，按渠道审计 `ma.channel.credential_resolve`，审计失败不返回密钥）——是对 §12「Vault 解析须有会话引用」规则的一个登记例外。
- 渠道连接只跑在持有 PG advisory lock 的单个 agent-runtime 副本；只支持飞书长连接。
- 「跟随最新」= Agent `latest_version`（不是生效版本），版本变化时渠道会话换新会话；渠道会话身份 = 渠道属主。
- agent-runtime 新增依赖 `lark-oapi`、`setuptools<81`。
