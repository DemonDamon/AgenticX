# AgenticX Enterprise · Managed Agent 产品操作手册

| 项 | 内容 |
|---|---|
| 产品 | AgenticX Enterprise · Admin Console / Workspace |
| 版本依据 | Admin Console · v0.3.5 / Workspace · v0.3.5（以界面角标为准） |
| 受众 | 运维、企业管理员、客户成功（CS） |
| 文档性质 | 管理台 **Managed Agent（托管智能体）** 操作说明 |
| 截图来源 | 本地管理台实测（2026-10-26），界面文案以当前版本为准 |
| 语言 | 中文说明；侧栏与页面同时支持中/英，下文在关键处标注 **中文名 / English** |

> **安全提示**：本文不包含任何密码、App Secret、Vault 主密钥或 PAT。登录请使用管理员账号（如企业下发的管理员邮箱），切勿把密钥写入手册或截图。

---

## 1. 概述

**Managed Agent（托管智能体）** 是 AgenticX Enterprise 中由平台统一登记、调度与计量的智能体运行能力。管理员在 **Admin Console（管理台）** 配置「谁可以跑、用什么模型与环境、凭证与记忆从哪来」；实际执行由独立服务 **agent-runtime（托管运行时）** 完成，并与 **Gateway（网关）**、**Portal（工作门户）** 协同。

可从两个侧栏分组理解：

| 分组 | 中文 / English | 管什么 |
|---|---|---|
| **Agent runtime** | 智能体运行 / Agent runtime | 智能体定义、会话观测、评测、定时任务、用量与配额 |
| **Agent resources** | 资源配置 / Agent resources | 执行环境、凭证库、记忆库、Webhook、IM 渠道 |

**Runtime（运行）** 回答「跑什么、何时跑、跑得怎样」；**Resources（资源）** 回答「在哪跑、用什么密钥与记忆、如何对外通知 / 接入飞书」。Portal 侧用户主要通过 **协作房间（Collaboration rooms）** 与已登记智能体协作，工作区首页未必出现单独的「Managed Agent」入口。

---

## 2. 前置条件

### 2.1 依赖服务

操作 Managed Agent 前，确认下列服务健康（本地开发默认端口供对照；生产以部署文档为准）：

| 服务 | 典型地址 | 用途 |
|---|---|---|
| Admin Console | `http://<host>:3001` | 管理台配置与观测 |
| Web Portal | `http://<host>:3000` | 工作门户 / 协作房间 |
| Gateway | `http://<host>:8088`（如 `/healthz`） | 模型与会话网关 |
| agent-runtime | `http://<host>:8092`（如 `/healthz`） | 托管智能体执行 |

管理台顶栏 / 底栏会显示 **Gateway healthy / Gateway online**（网关健康）或 **Gateway offline**（离线）。徽章短时抖动时，可刷新页面或检查 Gateway 进程后再继续配置。

### 2.2 功能开关（运维侧）

以下变量来自企业部署环境示例（`enterprise/.env.local.example` 与 agent-runtime README）。**值须由部署人员配置；手册只说明含义，不写入真实密钥。**

| 变量 | 作用（摘要） |
|---|---|
| `MA_RUNTIME_ENABLED=1` | 门户开启后，协作房间的云端智能体改由 agent-runtime 执行 |
| `MA_RUNTIME_URL` / `MA_RUNTIME_INTERNAL_URL` | 管理台 / 门户访问 agent-runtime 的地址 |
| `NEXT_PUBLIC_MA_EVALS_UI_ENABLED=1` | 管理台侧栏是否显示 **评测 / Evaluations** |
| `MA_RUNTIME_EVALS_ENABLED=1` | 运行时是否真正执行评测任务 |
| `MA_RUNTIME_SCHEDULER_ENABLED=1` | 是否开启定时任务 tick |
| `MA_RUNTIME_WEBHOOKS_ENABLED=1` | 是否开启 Webhook 入队与投递 |
| `MA_RUNTIME_CHANNELS_ENABLED=1` | 是否在持有锁的副本上跑飞书长连接 |
| `MA_RUNTIME_COMMAND_SANDBOX` | `required`（容器默认，探测失败拒启）或 `best_effort`（仅告警；本机无 OS 级隔离时需注意） |
| `MA_RUNTIME_AGENT_QUOTA_ENABLED=1` | 是否按「用户 × 智能体」检查日/周/月 token 配额 |
| `MA_QUOTA_TIMEZONE` | 配额日/周/月边界时区，默认 `Asia/Shanghai` |

内部通信还依赖 `MA_INTERNAL_TOKEN`（或 `_FILE`）、Gateway / Service PAT 文件、Vault 主密钥文件等——**仅部署人员持有，勿粘贴到手册或工单明文。**

### 2.3 管理员登录

1. 打开管理台登录页（例如 `/login`）。
2. 使用 **管理员账号** 登录（企业下发的管理员邮箱；开发环境常见为 `admin@agenticx.local`）。
3. 点击 **登录控制台 / Sign in to console**，进入仪表盘 **Dashboard**。

![管理台登录页](./shots/01-admin-login.png)

*图：Admin Console 登录页（Sign in to console）。*

![管理台仪表盘](./shots/02-dashboard.png)

*图：登录后 Dashboard（AgenticX Enterprise Control Center）。侧栏可见 Agent runtime / Agent resources 分组。*

### 2.4 业务前置（强烈建议）

在真正新建并运行智能体前，请先完成：

1. **平台 → 模型（Models）**：至少启用一个可用模型。无可用模型时，新建智能体对话框会提示「还没有已启用的模型 / No enabled models yet」，Portal 也会显示「No models available」。
2. （可选）登记 MCP / Skill，便于在智能体上绑定能力。
3. （可选）先建 **执行环境**、**凭证库**，再挂到智能体或定时任务 / IM 渠道。

---

## 3. 控制台导航地图

侧栏分组标题与菜单项同时有中英文（界面语言切换后文案会变）。下表以 E2E 实测路径为准：

| 分组（EN / ZH） | 菜单（EN / ZH） | 路由 |
|---|---|---|
| **Agent runtime** / 智能体运行 | Agents / 智能体 | `/admin/agents` |
| | Sessions / 会话 | `/ops/logs/managed` |
| | Evaluations / 评测 | `/admin/agent-evals`（需 `NEXT_PUBLIC_MA_EVALS_UI_ENABLED=1`） |
| | Schedules / 定时任务 | `/admin/agent-schedules` |
| | Agent Usage / 智能体用量 | `/metering/agents` |
| **Agent resources** / 资源配置 | Execution environments / 执行环境 | `/admin/agent-environments` |
| | Vaults / 凭证库 | `/admin/agent-vaults` |
| | Memory stores / 记忆库 | `/admin/agent-memory` |
| | Webhooks / Webhook 通知 | `/admin/agent-webhooks` |
| | IM Channels / IM 渠道 | `/admin/agent-channels` |

相关但不在上述两组内的入口：

| 场景 | 入口 |
|---|---|
| 启用模型 | 平台 / Platform → Models / 模型（`/admin/models`） |
| Portal 工作区 | `http://<portal>/workspace` |
| 协作房间 | `http://<portal>/rooms` |

---

## 4. Agent runtime 操作

### 4.1 Agents（智能体）

**路径**：`/admin/agents`  
**用途**：登记可在协作房间等场景使用的托管智能体，指定模型、提示词、能力与可见范围。

#### 列表与空状态

- 标题：**Agents / 智能体**
- 空状态：**No agents yet / 还没有智能体**
- 主按钮：**New agent / 新建智能体**

![智能体列表空状态](./shots/03-agents.png)

*图：Agents 列表空状态与「New agent」入口。*

#### 新建字段说明

点击 **New agent / 新建智能体** 打开对话框（保存前可随时 Cancel / 取消）：

| 字段（EN / ZH） | 说明 |
|---|---|
| Name / 名称 | 展示名 |
| Slug / 标识 | 小写字母、数字或连字符，2–63 位，以字母或数字开头。注意：空表单上可能预填示例值（如 `report-bot`），保存前请改成真实标识 |
| Description / 描述 | 用途说明 |
| Model / 模型 | 选择已启用模型；无模型时不可完成有效配置 |
| Runtime / 运行方式 | 默认 **Cloud / 云端执行**；亦可选员工桌面执行（需环境与开关支持） |
| System prompt / 系统提示词 | 角色与行为约束 |
| Knowledge search URL / 知识库地址 | 可选的外部知识检索地址 |
| Capabilities / 能力 | 绑定已登记的 **MCP** 与 **Skill** |
| Visibility / 可见范围 | 如 **Everyone / 全员** 开关 |
| Enabled / 启用 | 是否启用 |

![新建智能体对话框](./shots/03b-agents-new-dialog.png)

*图：New agent 对话框字段（含 Model / Runtime / System prompt / Capabilities）。*

保存后，可在列表中进行编辑、发布 / 回收、查看「定义与版本」等生命周期操作（以当前版本按钮文案为准）。发布后，命中可见范围的成员可在桌面或房间中使用。

---

### 4.2 Sessions（会话）

**路径**：`/ops/logs/managed`  
**面包屑**：Agent runtime > Sessions  
**用途**：观测托管会话（筛选、刷新、排查）。

#### 操作要点

1. 进入页面后若正文短暂空白，可点击 **Refresh / 刷新** 等待筛选区与列表出现（部分环境下首次绘制较慢，属运维观察点，而非长时间转圈）。
2. 筛选维度（实测）：**Agent**、**Requester email**、**Status**、**Source**、时间范围（如 Last 7 days）、以及 Search / Reset。
3. 空状态：**No managed sessions / 暂无托管会话**。

![托管会话空状态](./shots/04-logs-managed.png)

*图：Sessions 筛选条与空状态「No managed sessions」。*

---

### 4.3 Evaluations（评测）

**路径**：`/admin/agent-evals`  
**显示条件**：`NEXT_PUBLIC_MA_EVALS_UI_ENABLED=1`；真正跑评测还需 `MA_RUNTIME_EVALS_ENABLED=1`。

**用途**：用固定版本 + 评测集 + 评分标准批量验收智能体；人工确认后可产生**不自动生效**的候选版本。

#### 四个页签

| 页签（EN / ZH） | 用途与入口 |
|---|---|
| **Datasets / 评测集** | 管理用例集。按钮 **新建评测集**；列：名称、用例数、更新时间、操作 |
| **Rubrics / 评分标准** | 定义通过/打分规则。按钮 **新建评分标准** |
| **Runs / 评测任务** | **发起评测**；列：智能体与版本、评测集、评分标准、状态、进度、通过率、均分、发起时间、操作 |
| **Candidates / 候选版本** | 查看评测产生的候选；列：智能体、基线版本、来源任务、状态、创建时间、操作。创建候选版本后，**当前生效版本不变**，需到智能体页手动切换 |

![评测页 Datasets](./shots/05-agent-evals.png)

*图：Evaluations · Datasets 页签与「新建评测集」。*

![新建评测集对话框](./shots/05b-evals-dialog.png)

*图：新建评测集对话框（字段：名称）。*

> 说明：部分构建中页面外壳为英文、页签内操作为中文，属文案混排；**以当前版本文案为准**（相关修正见分支 `fix/ma-admin-i18n-e2e` / PR #134）。操作路径与字段含义不变。

---

### 4.4 Schedules（定时任务）

**路径**：`/admin/agent-schedules`  
**用途**：按 cron 为指定智能体打开**独立会话**，每次触发一条运行记录。运行时需 `MA_RUNTIME_SCHEDULER_ENABLED=1`。

#### 列表

- 空状态：**No schedules yet / 还没有定时任务**
- 按钮：**New schedule / 新建定时任务**
- 行内常见操作：编辑、立即运行、运行记录、删除（删除后不再触发，历史运行记录保留）

![定时任务列表](./shots/06-agent-schedules.png)

*图：Schedules 空状态。*

#### 新建字段

| 字段（EN / ZH） | 说明 |
|---|---|
| Name / 名称 | 任务名 |
| Description / 描述 | 可选说明 |
| Agent / 智能体 | 必选已登记智能体 |
| Version policy / 版本策略 | 默认 **Follow the agent version route / 跟随智能体版本路由**；或固定版本 |
| Environment / 执行环境 | 默认 **Agent default environment / 智能体默认环境** |
| Cron / 计划 | 示例预填 `0 9 * * 1-5`（工作日 09:00） |
| Time zone / 时区 | 示例预填 `Asia/Shanghai` |
| Input / 输入内容 | 触发时发给智能体的内容。可用占位符：`{{date}}`、`{{datetime}}`、`{{schedule_name}}`、`{{run_id}}` |

![新建定时任务对话框](./shots/06b-schedule-dialog.png)

*图：New schedule 对话框（Cron、时区、Input 等）。截图若出现原始 i18n key，属旧构建文案问题；预期应显示输入内容提示，以当前版本为准。*

运行状态常见取值：已排期 / 触发中 / 运行中 / 成功 / 失败 / 已跳过（跳过原因含错过、上一轮未结束、配置已变更、已停用、已删除等）。

---

### 4.5 Agent Usage（智能体用量）

**路径**：`/metering/agents`  
**用途**：按托管会话汇总用量；配额周期边界默认按 `Asia/Shanghai`（可由 `MA_QUOTA_TIMEZONE` 覆盖）。

#### Usage / 用量

- 时间：Start / End
- **分组维度（勾选）**：Agent（默认）、User、Dept、Model、Day
- 点击 **Query / 查询**
- 表头常见列：Agent、Name、Input、Output、Total、Requests、Sessions

无数据时表体可能为空（未必有「暂无数据」行），属空库正常现象。

![智能体用量 Usage](./shots/07-metering-agents.png)

*图：Agent Usage · Usage 页签与查询维度。*

#### Quotas / 配额

- 选择 Agent 后查看/配置「用户 × 智能体」相关配额（需运行时开启 `MA_RUNTIME_AGENT_QUOTA_ENABLED` 才会在执行侧真正拦截）。
- 尚无智能体时，下拉可能为空。

![智能体用量 Quotas](./shots/07c-metering-quotas.png)

*图：Agent Usage · Quotas 页签。*

---

## 5. Agent resources 操作

### 5.1 Execution environments（执行环境）

**路径**：`/admin/agent-environments`  
**用途**：定义托管会话在哪里执行——云端沙箱或员工桌面。

- 空状态：**No execution environments yet / 还没有执行环境**
- **New environment / 新建环境** 字段：

| 字段（EN / ZH） | 说明 |
|---|---|
| Name / 名称 | 环境名 |
| Description / 描述 | 可选 |
| Type / 类型 | 默认 Cloud / 云端执行；或员工桌面执行 |
| Sandbox backend / 沙箱后端 | Container / 容器；远程沙箱；本机进程（仅开发调试） |
| Image / 镜像 | 容器镜像 |
| Outbound allowlist / 出站白名单 | 每行一个域名 |
| Idle recycle time / 空闲回收时间 | 秒，示例默认 `3600` |

![执行环境列表](./shots/08-agent-environments.png)

*图：Execution environments 空状态。*

![新建执行环境](./shots/08b-environment-dialog.png)

*图：New environment 对话框。*

停用后新会话不可再选用该环境，进行中会话不受影响。可在智能体「默认执行环境」或定时任务 / IM 渠道中引用。

---

### 5.2 Vaults（凭证库）

**路径**：`/admin/agent-vaults`  
**用途**：登记 MCP 令牌与环境变量密钥；会话引用后由运行时注入，**智能体看不到原文**。

- 开关：**Show archived / 显示已归档**
- 空状态：**No vaults yet / 还没有凭证库**
- 新建只需 **Name / 名称**、**Description / 描述**；创建后再进入详情 **新增凭证**（类型示例：MCP 静态令牌、MCP OAuth、HTTPS Bearer、环境变量等）。

![凭证库列表](./shots/09-agent-vaults.png)

*图：Vaults 空状态。*

![新建凭证库](./shots/09b-vault-dialog.png)

*图：New vault 对话框。*

运维注意：Vault 主密钥由部署侧文件配置；密钥丢失会导致已存凭证无法解密。轮换、归档、删除前请确认无进行中会话强依赖。

---

### 5.3 Memory stores（记忆库）

**路径**：`/admin/agent-memory`  
**用途**：让智能体跨会话保留偏好与经验；挂载后以文件形式读写，变更可追溯。

- **Show archived / 显示已归档**
- 空状态：**No memory stores yet / 还没有记忆库**
- 新建：Name / 名称、Description / 描述
- 建议：共享知识优先只读挂载；读写挂载可能沉淀不可信内容

![记忆库列表](./shots/10-agent-memory.png)

*图：Memory stores 空状态。*

![新建记忆库](./shots/10b-memory-dialog.png)

*图：New memory store 对话框。*

部分环境下首次进入正文短暂空白，稍候或刷新即可；非无限加载。

---

### 5.4 Webhooks（Webhook 通知）

**路径**：`/admin/agent-webhooks`  
**用途**：按订阅事件向接收地址推送**签名通知**。需 `MA_RUNTIME_WEBHOOKS_ENABLED=1`。

- 空状态：**No webhooks yet / 还没有 Webhook**
- **New webhook / 新建 Webhook** → **Create webhook endpoint / 新建 Webhook 端点**

#### 表单要点

| 项 | 说明 |
|---|---|
| Endpoint URL / 端点 URL | 示例占位 `https://example.com/webhooks` |
| Name / 名称 | 最长 120 |
| Description / 描述 | 可选，最长 2048 |
| Event types / 事件类型 | 共 **29** 种；支持 Select all / 全选 |
| Advanced / 高级设置 | 可限定智能体、来源（门户/桌面/API/定时/IM/评测等）、是否附带回复正文 |

#### 事件目录概要（8 组 / 29 类）

| 分组（EN / ZH） | 数量 | 事件 key（摘要） |
|---|---|---|
| Sessions / 会话 | 4 | `session.status_run_started`、`session.status_idled`、`session.idle`、`session.failed` |
| Multi-agent threads / 多智能体线程 | 3 | `session.thread_created`、`session.thread_idled`、`session.thread_terminated` |
| Agents / 智能体 | 3 | `agent.created`、`agent.version_published`、`agent.deleted` |
| Environments / 执行环境 | 3 | `environment.created`、`environment.updated`、`environment.deleted` |
| Vaults / 凭证库 | 7 | `vault.*`、`vault_credential.*`、`credential.expiring` |
| Memory stores / 记忆库 | 3 | `memory_store.created` / `archived` / `deleted` |
| Schedules / 定时任务 | 3 | `schedule.created` / `updated` / `deleted` |
| Schedule runs / 定时运行 | 3 | `schedule_run.started` / `succeeded` / `failed` |

创建成功后会生成签名密钥（**关闭后通常不能再次查看**，请安全保存）。可查看投递记录、轮换密钥。连续失败或接收方返回 410 时可能自动停用。

![Webhook 列表](./shots/11-agent-webhooks.png)

*图：Webhooks 空状态。*

![创建 Webhook 端点](./shots/11b-webhook-dialog.png)

*图：Create webhook endpoint（事件目录与端点 URL）。*

> 刚打开页面时首次点击「新建」若未弹出对话框，可再点一次（偶发 hydration 竞态）；以第二次点击打开为准。

---

### 5.5 IM Channels（IM 渠道）

**路径**：`/admin/agent-channels`  
**用途**：将**飞书自建应用**绑定到智能体；应用密钥放入单独凭证库。需 `MA_RUNTIME_CHANNELS_ENABLED=1` 才会在运行时建立长连接。

- 空状态：**No IM channels yet** — 「绑定飞书应用后，长连接会在运行时里建立。」
- **New channel / 新建渠道** → **New IM channel / 新建 IM 渠道**

| 字段（EN / ZH） | 说明 |
|---|---|
| Name / 名称 | 渠道名 |
| Agent / 智能体 | 绑定的托管智能体 |
| Version policy / 版本策略 | Follow latest / 跟随最新，或 Pinned version / 固定版本 |
| Environment / 执行环境 | 可不指定 |
| Feishu app ID / 飞书应用 ID | 自建应用 App ID |
| Vault / 凭证库 | 建议「单独建库」存放密钥 |
| App secret / 应用密钥 | **勿写入手册或截图** |
| Site / 站点 | Feishu / 飞书，或 Lark 国际版 |
| Hours of silence / 空闲多久后开新会话 | 小时，示例默认 `24` |

连接状态常见：待连接 / 连接中 / 已连接 / 异常 / 已停止。删除后机器人不再回复，已产生会话保留。

![IM 渠道列表](./shots/12-agent-channels.png)

*图：IM Channels 空状态。*

![新建 IM 渠道](./shots/12b-channel-dialog.png)

*图：New IM channel 对话框（含 Feishu app ID、Vault、空闲小时数）。*

---

## 6. Portal 侧相关入口

Managed Agent 的**配置在管理台**；终端用户主要在 Portal 使用。

| 入口 | 说明 |
|---|---|
| `/auth` | 登录工作门户（如 Log in to Machi） |
| `/workspace` | 工作区：New chat、Deep research、**Collaboration rooms**、My projects；用量卡片；模型选择器 |
| `/rooms` | **协作房间 / Collaboration rooms**：新建房间（Room name）并邀请同事 |

工作区侧栏**未必**出现名为「Managed Agent」的独立控件；协作入口为 **Collaboration rooms**。当 `MA_RUNTIME_ENABLED=1` 且已登记云端智能体、模型可用时，房间内云端智能体由 agent-runtime 执行。

![Portal 工作区](./shots/14-portal-workspace.png)

*图：Portal Workspace 首页（含 Collaboration rooms 入口）。*

![协作房间](./shots/15-portal-rooms.png)

*图：Collaboration rooms 空状态。*

若模型选择器显示「No models available」，请回到管理台启用模型后再试。

---

## 7. 推荐操作流程

建议按依赖顺序落地，避免「智能体已建但无法跑」：

```text
① 确认服务健康（Admin / Portal / Gateway / agent-runtime）
        ↓
② 平台启用至少一个模型（必要时登记 MCP / Skill）
        ↓
③ Agent resources：新建 Execution environment（执行环境）
        ↓
④ Agent resources：新建 Vault（凭证库）并录入凭证（密钥勿外泄）
        ↓
⑤ （可选）新建 Memory store（记忆库）
        ↓
⑥ Agent runtime：新建 Agent，绑定模型 / 环境 / 能力，发布
        ↓
⑦ （可选）Schedules：配置 cron + Input；或 Webhooks：订阅事件；或 IM Channels：绑定飞书
        ↓
⑧ 在 Portal 协作房间验证一轮对话
        ↓
⑨ Sessions 观测会话；Agent Usage 查看用量 / 配额
```

评测路径（可选）：Datasets → Rubrics → Runs →（人工）Candidates → 在 Agents 页切换生效版本。

---

## 8. 常见问题 / 运维注意

| 现象 | 建议处理 |
|---|---|
| 新建智能体提示「还没有已启用的模型」；Portal「No models available」 | 先在平台 **Models** 启用模型。**无模型时无法真正跑通 Managed Agent** |
| 侧栏没有「评测 / Evaluations」 | 检查 `NEXT_PUBLIC_MA_EVALS_UI_ENABLED` 是否为 `1`，并重新构建/发布管理台前端 |
| 定时任务到点不触发 | 确认 `MA_RUNTIME_SCHEDULER_ENABLED=1`、任务已启用、cron/时区正确、agent-runtime 健康 |
| Webhook 无投递 | 确认 `MA_RUNTIME_WEBHOOKS_ENABLED=1`、端点可达；生产注意回环/私网策略相关变量 |
| 飞书机器人不回复 | 确认 `MA_RUNTIME_CHANNELS_ENABLED=1`、App ID/密钥/Vault 正确、连接状态为「已连接」 |
| Linux / 本机沙箱 | `MA_RUNTIME_COMMAND_SANDBOX=best_effort` 时探测失败仅告警，**bash 可能没有 OS 级隔离**；生产容器建议 `required` |
| Gateway 徽章偶发红绿切换 | 短时抖动可刷新；持续 offline 时查 Gateway 进程与内部 token |
| Sessions / Memory / Channels 首屏短暂空白 | 等待数秒或点 Refresh；内容应在可接受时间内出现 |
| 界面中英混排或偶发原始 i18n key | **界面文案以当前版本为准**；功能路径不变。相关文案修复见 `fix/ma-admin-i18n-e2e` / PR #134 |
| 配额未生效 | 用量页可查，但执行侧拦截依赖 `MA_RUNTIME_AGENT_QUOTA_ENABLED=1` |
| 新建 Agent 时 Slug 预填 `report-bot` | 视为示例默认值，保存前改为业务标识 |

---

## 附录 A · 本文嵌入截图清单

| 文件 | 内容 |
|---|---|
| `shots/01-admin-login.png` | 管理台登录 |
| `shots/02-dashboard.png` | Dashboard |
| `shots/03-agents.png` | Agents 列表 |
| `shots/03b-agents-new-dialog.png` | 新建智能体 |
| `shots/04-logs-managed.png` | Sessions |
| `shots/05-agent-evals.png` | Evaluations · Datasets |
| `shots/05b-evals-dialog.png` | 新建评测集 |
| `shots/06-agent-schedules.png` | Schedules 列表 |
| `shots/06b-schedule-dialog.png` | 新建定时任务 |
| `shots/07-metering-agents.png` | Agent Usage · Usage |
| `shots/07c-metering-quotas.png` | Agent Usage · Quotas |
| `shots/08-agent-environments.png` | 执行环境列表 |
| `shots/08b-environment-dialog.png` | 新建执行环境 |
| `shots/09-agent-vaults.png` | 凭证库列表 |
| `shots/09b-vault-dialog.png` | 新建凭证库 |
| `shots/10-agent-memory.png` | 记忆库列表 |
| `shots/10b-memory-dialog.png` | 新建记忆库 |
| `shots/11-agent-webhooks.png` | Webhooks 列表 |
| `shots/11b-webhook-dialog.png` | 创建 Webhook 端点 |
| `shots/12-agent-channels.png` | IM Channels 列表 |
| `shots/12b-channel-dialog.png` | 新建 IM 渠道 |
| `shots/14-portal-workspace.png` | Portal Workspace |
| `shots/15-portal-rooms.png` | Collaboration rooms |

未嵌入但可在原始 E2E 目录查阅的截图：首屏空白对比（`04a` / `10a` / `12a`）、用量查询后（`07b`）、Portal 登录与新建房间（`13` / `15b`）等，见 `/workspace/agenticx-e2e-logs/shots/`。

## 附录 B · 证据来源

- E2E 结果：`/workspace/agenticx-e2e-logs/E2E_RESULTS.md`（2026-10-26）
- E2E 清单：`/workspace/agenticx-e2e-logs/E2E_CHECKLIST.md`
- 管理台文案：`enterprise/apps/admin-console/messages/zh.json` / `en.json`
- 环境示例：`enterprise/.env.local.example`、`enterprise/apps/agent-runtime/README.md`

---

*文档结束。如部署版本与 v0.3.5 界面不一致，以线上管理台实际菜单与字段为准，并同步更新本手册截图。*
