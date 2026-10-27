# MA-D02 企业 Agent 入口：专家页企业区块、只读定义抽屉、托管会话窗格

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W3 · MA-D02）
Depends-on:
- MA-E01 / MA-E02（已实现：`enterprise_agents` MA 列、`listAgentsWithMa`、`getAgentWithMa`、`getAgentVersion`、`listMaEnvironments`）
- MA-E03 `.cursor/plans/pending/2026-10-25-ma-e03-agent-runtime-service.plan.md`（未实施：agent-runtime 会话面）
- MA-D01 `.cursor/plans/pending/2026-10-25-ma-d01-near-worker-v2.plan.md`（未实施：agent-runtime 接受设备 PAT 与桌面会话授权；本机 `POST /api/enterprise-worker/interactive-environments`）
- MA-D03 `.cursor/plans/pending/2026-10-25-ma-d03-managed-session-rendering.plan.md`（未实施：`ma-*` IPC、`useManagedSession`、`ManagedTranscript`、收件箱接入）

> 风险等级：中。
>
> **上游未实现声明**：E03 / D01 / D03 写作时未合入；引用的接口、hook、组件名按各自 plan 书写，**以实际实现为准，实施前核对**：`rg -n "useManagedSession|ManagedTranscript|maPostEvents|maStreamOpen" desktop/src desktop/electron` 与 `rg -n "interactive-environments" agenticx/studio`。
>
> **栈说明（偏离 master §0 规则 1，须用户确认，见 §12 Q1）**：Desktop（渲染 + 主进程）+ Python（`agx serve` 两个小改动）+ web-portal TS（`/api/desktop/agents` 增量字段与 1 个详情路由）。web-portal 改动是设备 PAT 读取「已分配给我的 Agent + 版本 + 环境」的唯一合法通道（理由见 §2 D1）。

---

## 0. 一句话目标

员工在 Near「专家」页看到企业分发给自己的托管 Agent（企业标记、生效版本号、云端 / 本机执行），可打开只读定义抽屉，并直接开一个托管会话窗格对话：`cloud` 环境的 Agent 在 agent-runtime 云端执行；`desktop_worker` 环境的 Agent 由本机 Near Worker 以交互方式领取执行；两者都走同一套 MA 会话协议与 MA-D03 的渲染。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 本文落点 |
|---|---|---|
| §2.2 | 桌面拥有「企业 Agent 的入口与渲染」 | 本文 + D03 |
| §4 决策 2 | 两种执行位置，一套协议 | §5.6 `ensureSession` |
| §4 决策 4 | 会话面在 agent-runtime；调用凭证为 iam-core PAT | 设备 PAT 经 D01 映射 |
| §4 决策 7 | 会话创建时锁定版本 | 窗格头展示会话锁定的 `agent_version` |
| §4 决策 9 | 个人模式不变 | §10 |
| §7 W3 门 | 员工在 Near 看到被分发的企业 Agent（企业标记、版本号），直接对话；`always_ask` 工具进审批收件箱 | §5.4–§5.6 + D03 |
| §9 MA-D02 行 | 侧栏展示已分发企业 Agent（企业标记、版本号、只读定义抽屉）；按 Agent 默认环境选云端或本机；扩展 `fetch_published_agents` 返回版本与环境 | 见 §2 D2（侧栏落点说明） |

### 1.2 现状代码证据（实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `enterprise/apps/web-portal/src/app/api/desktop/agents/route.ts` | 1–28 | `GET`：`resolveDesktopIdentity` → `resolveAssignmentKeysForUser` → `listAgentsVisibleToKeys`；返回 `{agents:[{id,slug,displayName,description,runtime,model,origin,systemPrompt}]}` | 在此追加字段（只加不改） |
| `enterprise/apps/web-portal/src/lib/desktop-auth.ts` | 3–4、26–55 | 设备 PAT scopes = `["workspace:chat","desktop:managed"]`；`resolveDesktopIdentity` 返回 `{userId, tenantId, deptId, email, ...}` | 设备 PAT 没有 `ma:agents:read` |
| `enterprise/packages/iam-core/src/repos/agents.ts` | 212–214、467–471、770–781 | `isVisibleToEmployees`（active + published）；`listAgentsWithMa(tenant)`、`getAgentWithMa(tenant,id)`（含 `latestVersion`、`defaultEnvironmentId`、`versionRouting`、`pinnedVersion`、`effectiveVersion`）；`listAgentsVisibleToKeys` | 富化数据来源 |
| `enterprise/packages/iam-core/src/repos/agent-versions.ts` | 158–165 | `getAgentVersion(tenant, agentId, version)` → `{version, manifest, manifestHash, note, source, createdBy, createdAt}` | 详情路由 |
| `enterprise/packages/iam-core/src/repos/ma-environments.ts` | 301–325 | `listMaEnvironments(tenant, {status?, type?})`、`getMaEnvironment` | 默认环境名称 / 类型 |
| `.cursor/plans/2026-10-25-ma-e02-agent-versioning-admin.plan.md` | §5.2–§5.3 | 公共 `GET /api/ma/v1/agents` 要 `ma:agents:read`，**返回租户全部 Agent、不做分配过滤** | 不能给设备 PAT 用（D1） |
| `agenticx/runtime/enterprise_agent_sync.py` | 19–33、70–88 | `_settings()`；`fetch_published_agents()` 透传 `payload["agents"]` 中的 dict | 新字段自动透传；追加详情函数 |
| `agenticx/studio/enterprise_worker_routes.py` | 36–41 | `GET /api/enterprise-agents` → `{"agents": fetch_published_agents()}` | 追加详情路由；该模块已在 `server.py:118` 注册，`server.py` 零改动 |
| `desktop/src/components/gallery/AvatarGalleryView.tsx` | 66–107、243–258 | 已拉 `/api/enterprise-agents`，在标题下渲染「企业已发布」只读 chip（名称 + 本机执行 / 云端执行） | 升级为可点击卡片区块 |
| `desktop/src/components/AvatarSidebar.tsx` | 42–58、285–308 | 侧栏只有导航项（新建任务 / 专家 / 协作 / 定时 / Wiki / 市场）与历史会话，**没有分身列表**；分身在「专家」主视图（`mainView === "avatars"` → `AvatarGalleryView`，`App.tsx:2698`） | 企业 Agent 放在「专家」视图（D2） |
| `desktop/src/hooks/usePaneNavigation.ts` | 34–140 | `openMetaOrAvatarPane(avatarId, name)`：已有窗格则聚焦，否则 `addPane(avatarId, name, "")` 并恢复最近会话 | 新增 `openManagedAgentPane` |
| `desktop/src/store.ts` | 211–287、828、839、947 | `ChatPane` 字段；`addPane(avatarId, avatarName, sessionId)`；`removePane`；`setPaneSessionId(paneId, sid, modelHint?)` | 托管窗格复用 `ChatPane` 结构，`avatarId = "ma:<agentId>"` |
| `desktop/src/components/PaneManager.tsx` | 281–290 | `renderChatPane(pane, focused)` 统一渲染 `<ChatPane .../>` | 按 `avatarId` 前缀分流到 `ManagedChatPane` |
| `desktop/src/utils/studio-fetch.ts` | 24–41 | `studioFetch(path, {apiToken})` 访问本机 `agx serve` | 渲染进程访问本机 Studio |
| `desktop/locales/zh/sidebar.json` | 262 | `gallery` 文案节（`AvatarGalleryView` 用 `useTranslation("sidebar")`，:48） | 新文案放这里 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | Agent 目录走 **web-portal `/api/desktop/agents`（增量字段）+ 新详情路由**，不用公共 `/api/ma/v1/agents` | ① 设备 PAT scopes 只有 `workspace:chat`、`desktop:managed`，公共接口要求 `ma:agents:read`；② 即便补 scope，公共列表返回租户全部 Agent 且不按 `assignment_keys` 过滤，会把未分配的 Agent（含系统提示）暴露给每个员工；③ `/api/desktop/agents` 已按分配键过滤，是现成的设备侧 BFF |
| D2 | 「侧栏」落点 = 侧栏导航「专家」进入的 `AvatarGalleryView` 中的企业区块（升级现有「企业已发布」chip） | Near 侧栏已无分身列表（证据 1.2）；在导航栏新增列表会破坏现有侧栏信息架构；W3 门要求的「看到 + 企业标记 + 版本号 + 直接对话」在专家页满足 |
| D3 | 托管窗格 `avatarId = "ma:<agentId>"`，与 `group:` / `automation:` 同风格；`PaneManager` 据此渲染 `ManagedChatPane`，**不进入 `ChatPane.tsx`** | 个人模式零改动；ChatPane 1.6 万行，混入新协议风险高 |
| D4 | 会话一律在 agent-runtime 创建（主进程 IPC `ma-create-session`，`source:"desktop"`）。`desktop_worker` 目标先调本机 `POST /api/enterprise-worker/interactive-environments` 注册交互式环境，再带 `environment_id` 建会话；随后由本机 Worker 领取（D01 规则：`source=desktop` 的会话只归创建者） | 同一协议、同一控制面审计；推理与工具留在本机（master §1.3） |
| D5 | 最近会话按 Agent 记在 `localStorage["agx-ma-last-session-v1"]`（`{[agentId]: {sessionId, updatedAt}}`），打开窗格优先恢复；「新对话」按钮创建新会话 | 冻结契约里没有会话列表接口；满足「关闭再打开回到最近会话」 |
| D6 | 托管窗格不显示模型选择器，只读展示 Manifest 模型 | 版本锁定模型；AGENTS.md 多窗格模型独立规则针对个人窗格 |
| D7 | 首版输入只支持纯文本；附件按钮不显示 | A04 `content_to_model_text` 对图片 / 文件块标记 unsupported 并跳过；避免「可选但无效」 |
| D8 | 目录富化失败（例如旧库缺 MA 表）时 `/api/desktop/agents` 仍返回原字段，新字段取保守默认并 `console.warn` | 旧版 Near 与旧库不受影响 |

---

## 3. In scope / Out of scope

### 3.1 In scope

**web-portal（TS）**
- 修改 `enterprise/apps/web-portal/src/app/api/desktop/agents/route.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/[agentId]/route.ts`
- 新建 `enterprise/apps/web-portal/src/lib/desktop-agent-catalog.ts`（富化与摘要纯函数）
- 新建 `enterprise/apps/web-portal/src/lib/desktop-agent-catalog.test.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/__tests__/route.test.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/__tests__/detail-route.test.ts`

**Python（`agx serve`）**
- 修改 `agenticx/runtime/enterprise_agent_sync.py`（追加 `fetch_enterprise_agent_detail`）
- 修改 `agenticx/studio/enterprise_worker_routes.py`（追加 `GET /api/enterprise-agents/{agent_id}`）
- 新建 `tests/test_enterprise_agent_catalog_d02.py`

**Desktop**
- 修改 `desktop/electron/main.ts`（追加 IPC `ma-create-session`）
- 修改 `desktop/electron/preload.ts`、`desktop/src/global.d.ts`（`maCreateSession`）
- 修改 `desktop/tests/ma-session-client.test.ts`（D03 文件，追加 1 个用例）
- 新建 `desktop/src/utils/ma-pane.ts`、`desktop/src/utils/ma-pane.test.ts`
- 新建 `desktop/src/components/gallery/EnterpriseAgentSection.tsx`
- 新建 `desktop/src/components/gallery/EnterpriseAgentDrawer.tsx`
- 新建 `desktop/src/components/gallery/EnterpriseAgentSection.test.tsx`
- 修改 `desktop/src/components/gallery/AvatarGalleryView.tsx`（替换 :66–107 的数据结构与 :243–258 的 chip 渲染）
- 修改 `desktop/src/hooks/usePaneNavigation.ts`（追加 `openManagedAgentPane`）
- 修改 `desktop/src/components/PaneManager.tsx`（`renderChatPane` 分流 1 处）
- 新建 `desktop/src/components/managed/ManagedChatPane.tsx`
- 新建 `desktop/src/components/managed/ManagedChatPane.test.tsx`
- 修改 `desktop/locales/zh/sidebar.json`、`desktop/locales/en/sidebar.json`（`gallery.enterprise.*`、`managedPane.*`）
- **条件性**修改 `desktop/src/App.tsx`：仅当实施时发现启动恢复 / 预取逻辑会拿 `ma:` 窗格的 `sessionId` 调本机 `/api/session*` 接口时，在该处加 `if (isManagedPaneAvatarId(pane.avatarId)) continue/return`（`rg -n "pane\.sessionId|p\.sessionId" desktop/src/App.tsx` 逐处检查）；没有则不改

### 3.2 Out of scope

- `ChatPane.tsx`、`ChatView.tsx`、`AvatarSidebar.tsx`（侧栏导航不加新项）。
- 公共 `/api/ma/v1/*`、admin-console、agent-runtime（授权由 D01 负责）。
- 会话列表 / 历史搜索 / 跨设备同步托管会话；归档按钮。
- 附件、语音、@ 文件引用；托管窗格的复制 / 收藏 / 多选（见 D03 Q2）。
- `POST /api/desktop/agents/register`、`registerEmployeeAgent`（D04 另行处理发布）。

---

## 4. 数据与协议

### 4.1 `GET /api/desktop/agents`（增量）

每个元素在原 8 个键之外追加：

```json
{
  "id": "01J…", "slug": "report-bot", "displayName": "报告助手", "description": null,
  "runtime": "cloud", "model": "openai/gpt-4o", "origin": "enterprise", "systemPrompt": "…",
  "latestVersion": 3,
  "effectiveVersion": 2,
  "routingMode": "pinned",
  "defaultEnvironment": { "id": "01J…", "name": "研发桌面", "type": "desktop_worker" },
  "executionTarget": "desktop_worker",
  "ownedByMe": false
}
```

- `executionTarget` = `defaultEnvironment?.type ?? runtime`。
- `defaultEnvironment`：`defaultEnvironmentId` 为空、环境不存在或 `status !== "active"` → `null`。
- `ownedByMe` = `origin === "employee" && ownerUserId === identity.userId`。
- 富化失败（D8）：`latestVersion: 1, effectiveVersion: 1, routingMode: "follow_latest", defaultEnvironment: null, executionTarget: runtime, ownedByMe` 照算。

### 4.2 `GET /api/desktop/agents/:agentId`（新建）

- 未登录 / PAT 无效 → `workerUnauthorized()`（与列表路由同一函数，`lib/worker-tasks/protocol`）。
- `agentId` 非 ULID（`/^[0-9A-HJKMNP-TV-Z]{26}$/`）或不在「对我可见」集合 → 404 `{"code":"40400","message":"智能体不存在或未分配给你"}`。
- 200：

```json
{
  "agent": { "…与列表元素相同的 14 个键…" },
  "version": {
    "version": 2,
    "createdAt": "2026-10-26T08:00:00.000Z",
    "note": "加工具",
    "summary": {
      "model": "openai/gpt-4o",
      "system": "你是报告助手……",
      "builtin": { "defaultPolicy": "always_allow",
                   "overrides": [ { "name": "bash_exec", "policy": "always_ask", "enabled": true } ] } ,
      "mcp": [ { "server": "github", "transport": "http", "defaultPolicy": "always_ask",
                 "overrides": [ { "name": "get_issue", "policy": "always_allow", "enabled": true } ] } ],
      "custom": [ { "name": "lookup_order", "description": "…" } ],
      "skills": [ { "source": "tenant", "id": "01J…", "version": "1.2.0" } ],
      "maxToolRounds": 40,
      "welcomeMessage": "…",
      "suggestedQuestions": ["…"]
    }
  }
}
```

`summary` 由 `buildManifestSummary(manifest)` 生成：**不输出** `mcp_servers[].url`（只输出名称与 transport）；`builtin` 为 null 表示 Manifest 无内置工具集；`overrides` 只列 `configs` 中显式写出的项（`policy` 为 null 时输出 `null`，前端显示「继承默认」）。

### 4.3 本机 Studio `GET /api/enterprise-agents/{agent_id}`（新建）

- `agent_id` 不匹配 `^[0-9A-HJKMNP-TV-Z]{26}$` → 400 `detail="invalid agent id"`。
- 未登录企业（`enterprise_agent_sync._settings()` 为 None）→ 409 `detail="enterprise_login_required"`。
- 门户 404 → 404 `detail="enterprise agent not found"`；其它失败 → 502 `detail="enterprise unavailable"`。
- 200：门户 JSON 原样返回。

### 4.4 主进程 IPC `ma-create-session`

入参 `{ agentId: string; environmentId?: string; title?: string }`：`agentId` 须为 ULID；`environmentId` 可选（ULID）；`title` 截断到 200 字符。行为：`resolveMaEndpoint(loadAgxConfig())`（D03）为 null → `{ok:false,status:0,code:"enterprise_login_required",message:"请先登录企业账号"}`；否则 `maRequest(ep, "POST", "/sessions", { body: { agent_id, source: "desktop", title?, environment_id? } })`。返回 `MaRestResult<SessionRecord>`（`SessionRecord` 字段见 `agenticx/managed/protocol.py:395-411`）。

### 4.5 `localStorage["agx-ma-last-session-v1"]`

```json
{ "01JAGENT…": { "sessionId": "01JSESS…", "updatedAt": 1793000000000 } }
```

最多保留 100 个 Agent（按 `updatedAt` 淘汰最旧）；解析失败视为空。

---

## 5. 精确落点

### 5.1 web-portal：`src/lib/desktop-agent-catalog.ts`（新建）

```ts
import type { EnterpriseAgent, EnterpriseAgentWithMa, MaEnvironment } from "@agenticx/iam-core";

export type DesktopAgentCard = {
  id: string; slug: string; displayName: string; description: string | null;
  runtime: "cloud" | "desktop_worker"; model: string; origin: "enterprise" | "employee"; systemPrompt: string;
  latestVersion: number; effectiveVersion: number; routingMode: "follow_latest" | "pinned";
  defaultEnvironment: { id: string; name: string; type: "cloud" | "desktop_worker" } | null;
  executionTarget: "cloud" | "desktop_worker";
  ownedByMe: boolean;
};

export function toDesktopAgentCard(
  agent: EnterpriseAgent,
  ma: EnterpriseAgentWithMa | undefined,
  envById: ReadonlyMap<string, MaEnvironment>,
  viewerUserId: string,
): DesktopAgentCard;

export type ManifestSummary = { /* exactly the shape of §4.2 version.summary */ };
/** Never throws; unknown shapes yield empty sections. Never outputs mcp_servers[].url. */
export function buildManifestSummary(manifest: unknown): ManifestSummary;
```

类型名以 iam-core 实际导出为准（`EnterpriseAgent`、`EnterpriseAgentWithMa` 在 `repos/agents.ts:38、108`；`MaEnvironment` 在 `repos/ma-environments.ts`）。

### 5.2 web-portal：`src/app/api/desktop/agents/route.ts`（修改）

Before（:15–27）：直接 map 8 个键。After：

```ts
const agents = await listAgentsVisibleToKeys(identity.tenantId, keys);
let maById = new Map<string, EnterpriseAgentWithMa>();
let envById = new Map<string, MaEnvironment>();
try {
  const [withMa, envs] = await Promise.all([
    listAgentsWithMa(identity.tenantId),
    listMaEnvironments(identity.tenantId, { status: "active" }),
  ]);
  maById = new Map(withMa.map((a) => [a.id, a]));
  envById = new Map(envs.map((e) => [e.id, e]));
} catch (error) {
  console.warn("[desktop/agents] managed-agent enrichment unavailable", error);
}
return NextResponse.json({
  agents: agents.map((agent) => toDesktopAgentCard(agent, maById.get(agent.id), envById, identity.userId)),
});
```

原 8 个键的取值与顺序不变（`toDesktopAgentCard` 先写这 8 个键）。

### 5.3 web-portal：`src/app/api/desktop/agents/[agentId]/route.ts`（新建）

```ts
export const dynamic = "force-dynamic";
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const { agentId } = await context.params;
  const notFound = () => NextResponse.json({ code: "40400", message: "智能体不存在或未分配给你" }, { status: 404 });
  if (!ULID_RE.test(agentId)) return notFound();
  try {
    const keys = await resolveAssignmentKeysForUser(identity.tenantId, identity.userId, identity.email, identity.deptId);
    const visible = await listAgentsVisibleToKeys(identity.tenantId, keys);
    const agent = visible.find((a) => a.id === agentId);
    if (!agent) return notFound();
    const ma = await getAgentWithMa(identity.tenantId, agentId);
    const envs = await listMaEnvironments(identity.tenantId, { status: "active" });
    const version = await getAgentVersion(identity.tenantId, agentId, ma.effectiveVersion);
    return NextResponse.json({
      agent: toDesktopAgentCard(agent, ma, new Map(envs.map((e) => [e.id, e])), identity.userId),
      version: { version: version.version, createdAt: version.createdAt, note: version.note ?? null,
                 summary: buildManifestSummary(version.manifest) },
    });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
```

`workerErrorResponse` / `workerUnauthorized` 从 `../../../../../lib/worker-tasks/protocol`（相对层级以实际目录为准）导入。`AgentVersionNotFoundError` 等 iam-core 错误若 `workerErrorResponse` 未映射为 404，则在 catch 里按 `error.name` 判断 `AgentNotFoundError` / `AgentVersionNotFoundError` → `notFound()`。

### 5.4 Python

`agenticx/runtime/enterprise_agent_sync.py` 追加（文件顶部补 `from urllib.parse import quote`）：

```python
def fetch_enterprise_agent_detail(agent_id: str) -> dict[str, Any] | None:
    """GET {base}/api/desktop/agents/{agent_id}. None when logged out or not visible (404).

    Raises EnterpriseCatalogError for other failures so the route can answer 502.
    """
```

新增异常类 `EnterpriseCatalogError(Exception)`；未登录返回 `None` 前由调用方先用 `enterprise_login_configured()` 区分（新增函数：`return _settings() is not None`）。请求：`httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=8.0, trust_env=False)`（与 :76–81 相同惯例）；200 → `response.json()`（非 dict → `EnterpriseCatalogError`）；404 → None；其它 → `EnterpriseCatalogError(f"status {code}")`；网络异常 → `EnterpriseCatalogError("network")`。日志不得含 token。

`fetch_published_agents()` **不改**：门户新增字段经 `[item for item in agents if isinstance(item, dict)]`（:86）原样透传——这就是对它的「扩展」，在测试 FR-P1 中断言。

`agenticx/studio/enterprise_worker_routes.py` 追加：

```python
_AGENT_ID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

    @app.get("/api/enterprise-agents/{agent_id}")
    async def get_enterprise_agent(agent_id: str, x_agx_desktop_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        if not _AGENT_ID_RE.match(agent_id):
            raise HTTPException(status_code=400, detail="invalid agent id")
        if not enterprise_login_configured():
            raise HTTPException(status_code=409, detail="enterprise_login_required")
        try:
            detail = await asyncio.to_thread(fetch_enterprise_agent_detail, agent_id)
        except EnterpriseCatalogError:
            raise HTTPException(status_code=502, detail="enterprise unavailable")
        if detail is None:
            raise HTTPException(status_code=404, detail="enterprise agent not found")
        return detail
```

（`asyncio`、`re`、`HTTPException` 补到文件顶部 import；同步 httpx 调用放线程，避免阻塞事件循环。）

### 5.5 Desktop：`desktop/src/utils/ma-pane.ts`（新建）

```ts
export const MANAGED_PANE_PREFIX = "ma:";
export const MA_LAST_SESSION_KEY = "agx-ma-last-session-v1";
export const MA_LAST_SESSION_MAX = 100;

export type EnterpriseAgentCard = {
  id: string; displayName: string; description: string | null; runtime: "cloud" | "desktop_worker";
  model: string; origin: "enterprise" | "employee"; latestVersion: number; effectiveVersion: number;
  routingMode: "follow_latest" | "pinned";
  defaultEnvironment: { id: string; name: string; type: "cloud" | "desktop_worker" } | null;
  executionTarget: "cloud" | "desktop_worker"; ownedByMe: boolean;
};

export function isManagedPaneAvatarId(avatarId: string | null | undefined): boolean;   // startsWith "ma:" and rest is ULID
export function managedPaneAvatarId(agentId: string): string;
export function managedAgentIdOf(avatarId: string | null | undefined): string | null;
/** Defensive parse of /api/enterprise-agents body; missing new fields fall back like the portal (D8). Drops items without id/displayName. */
export function parseEnterpriseAgents(raw: unknown): EnterpriseAgentCard[];
export function getLastManagedSession(agentId: string, storage?: Storage): string | null;
export function rememberManagedSession(agentId: string, sessionId: string, storage?: Storage, now?: () => number): void;
export function forgetManagedSession(agentId: string, storage?: Storage): void;
```

### 5.6 Desktop：专家页企业区块

`AvatarGalleryView.tsx`：
- :66–68 状态类型改为 `EnterpriseAgentCard[]`；:91–99 改为 `setEnterpriseAgents(parseEnterpriseAgents(body))`。
- :243–258 的 chip 块替换为 `<EnterpriseAgentSection agents={enterpriseAgents} />`（列表为空时组件返回 null，外观与现状「不显示」一致）。

`EnterpriseAgentSection.tsx`（新建）：

```tsx
type Props = { agents: EnterpriseAgentCard[] };
export function EnterpriseAgentSection({ agents }: Props): JSX.Element | null;
```

- 标题 `t("gallery.enterprise.title")`「企业智能体」+ 数量。
- 卡片网格（与分身卡同一圆角 / 边框 token，`rounded-xl border border-border bg-surface-card`，hover `bg-surface-hover`）：首字母圆形头像（`rounded-full`，与分身一致）、名称、徽标「企业」（`bg-surface-card-strong text-text-strong` 小圆角标签，不用显眼粗边框）、`v{effectiveVersion}`（`routingMode === "pinned"` 时 tooltip「管理员固定的版本」）、执行位置标签（`executionTarget`：`云端执行` / `本机执行`）、`ownedByMe` 时追加「我发布的」。
- 整卡点击 → `openManagedAgentPane(agent)`；卡片右上角「定义」图标按钮（`FileText` 图标 + 自定义 `HoverTip`「查看定义」，`stopPropagation`）→ 打开抽屉。
- `executionTarget === "desktop_worker" && defaultEnvironment === null` 的卡片置灰、点击不开窗格，提示「管理员尚未为该智能体指定执行环境」。

`EnterpriseAgentDrawer.tsx`（新建）：

```tsx
type Props = { agentId: string; onClose: () => void };
export function EnterpriseAgentDrawer({ agentId, onClose }: Props): JSX.Element;
```

- `createPortal` 到 `document.body`；右侧抽屉宽 `min(480px, 92vw)`，遮罩与容器背景与 `SettingsPanel` 语义一致（不半透叠色发暗）；右上角 ✕ 为唯一关闭入口；`Esc` 关闭。
- 打开即 `studioFetch(\`/api/enterprise-agents/${agentId}\`, {apiToken})`：加载中骨架；409 → 「请先登录企业账号」；404 → 「智能体不存在或未分配给你」；其它 → 「加载失败，请稍后重试」+ 重试按钮。
- 内容（只读，无任何编辑或保存按钮）：名称 + 企业徽标 + 版本 `v{version}`（`createdAt` 本地时间、`note`）；描述；执行位置（`defaultEnvironment.name` 或「默认云端环境」）；模型；系统提示（`<pre>` 可滚动、最大高度 240px）；工具与权限（内置：默认策略 + 覆盖项表格；策略文案 `always_allow` → 「自动执行」、`always_ask` → 「每次询问」、`enabled:false` → 「已禁用」、`null` → 「继承默认」；MCP：服务名 + transport + 覆盖项；自定义工具：名称 + 描述 + 「由业务系统执行」）；技能（来源 + id + 版本）；欢迎语与推荐问题（若有）。

### 5.7 Desktop：打开窗格

`usePaneNavigation.ts` 追加并在返回对象中导出：

```ts
  const openManagedAgentPane = useCallback((agent: EnterpriseAgentCard) => {
    setMainView("chat");
    const avatarId = managedPaneAvatarId(agent.id);
    const existing = panes.find((item) => item.avatarId === avatarId && !item.composePreview);
    if (existing) { setActivePaneId(existing.id); setActiveAvatarId(null); return; }
    const paneId = addPane(avatarId, agent.displayName, getLastManagedSession(agent.id) ?? "");
    setActivePaneId(paneId);
    setActiveAvatarId(null);
  }, [panes, addPane, setActivePaneId, setActiveAvatarId, setMainView]);
```

`setActiveAvatarId(null)`：托管窗格不是本地分身，不能把 `ma:` id 写进「当前分身」（避免其它面板按分身 id 读本地配置）。

`PaneManager.tsx` `renderChatPane`（:281）：

```tsx
  const renderChatPane = (pane: ChatPaneState, isFocused: boolean) =>
    isManagedPaneAvatarId(pane.avatarId) ? (
      <ManagedChatPane paneId={pane.id} focused={isFocused} onFocus={() => setActivePaneId(pane.id)} />
    ) : (
      <ChatPane ...原有 props 不变... />
    );
```

### 5.8 Desktop：`ManagedChatPane.tsx`（新建）

```tsx
type Props = { paneId: string; focused: boolean; onFocus: () => void };
export function ManagedChatPane({ paneId, focused, onFocus }: Props): JSX.Element;
```

状态与流程：
1. `pane = useAppStore(s => s.panes.find(p => p.id === paneId))`；`agentId = managedAgentIdOf(pane.avatarId)`。
2. 挂载拉 `studioFetch(/api/enterprise-agents/${agentId})` 得 `agent` 卡片与 `version.summary`（模块级 `Map` 缓存 60 秒，抽屉与窗格共用）。失败状态同抽屉。
3. `view = useManagedSession(pane.sessionId || null, { assistantName: agent?.displayName ?? pane.avatarName })`（D03）。
4. 若 `pane.sessionId` 非空：`window.agenticxDesktop.maGetSession(sid)`：404 → `forgetManagedSession(agentId)` 并 `setPaneSessionId(paneId, "")`（回到「新对话」空态）；成功 → 记录 `lockedVersion = session.agent_version`、`environmentId = session.environment_id`。
5. **头部**（`border-b border-border bg-surface-panel`）：首字母头像 + 名称 + 「企业」徽标 + `v{lockedVersion ?? agent.effectiveVersion}` + 执行位置标签；右侧图标按钮：「定义」（打开 `EnterpriseAgentDrawer`）、「新对话」（`Sparkles` 图标 + `HoverTip`「新对话」；点击：`setPaneSessionId(paneId, "")`、`forgetManagedSession`）、关闭窗格 ✕（`removePane(paneId)`）。**不显示「分身」字样，也不显示 Machi 头像**。
6. **本机执行横幅**（`executionTarget === "desktop_worker"`）：一行 `text-xs text-text-subtle`：「本机执行：任务在这台电脑上运行，模型经企业网关调用」。
7. **消息区**：`pane.sessionId` 为空 → 空态：欢迎语（`summary.welcomeMessage` 或「向 {name} 提问」）+ 推荐问题 chip（点击填入输入框，不自动发送）；否则 `<ManagedTranscript view={view} sessionId={sid} assistantName=... userName=... />`。
8. **输入区**：多行 `textarea`（自适应高度，最多 8 行）；`Enter` 发送、`Shift+Enter` 换行；发送按钮（主题 `--ui-btn-primary-*`）；`transcript.status === "running"` 时发送按钮变「停止」（`view.interrupt()`）；`status === "requires_action"` 时输入框 placeholder「请先处理待审批的工具调用」且发送禁用；未登录企业 / agent 加载失败 / 不可执行时整体禁用并显示原因。
9. **`send(text)`**（乐观 UI）：
   ```text
   trimmed = text.trim(); if (!trimmed) return
   clear composer immediately; if no session: show local pending bubble (pendingFirst = trimmed)
   sid = pane.sessionId
   if (!sid):
       if (agent.executionTarget === "desktop_worker"):
           env = agent.defaultEnvironment; if (!env) -> fail("管理员尚未为该智能体指定执行环境")
           r = await studioFetch("/api/enterprise-worker/interactive-environments", {method:"POST", apiToken,
                 headers:{"Content-Type":"application/json"}, body: JSON.stringify({environment_id: env.id})})
           if (!r.ok) -> fail(r.status === 409 ? "请先登录企业账号" : "无法启动本机执行，请在「企业 Worker」中查看状态")
       created = await window.agenticxDesktop.maCreateSession({ agentId, environmentId: target==="desktop_worker" ? env.id : undefined, title: agent.displayName })
       if (!created.ok) -> fail(mapCreateError(created.code))
       sid = created.data.id; setPaneSessionId(paneId, sid); rememberManagedSession(agentId, sid)
   res = await view.sendMessage(trimmed)      // view re-binds to sid on next render; call via a ref that awaits ready
   if (!res.ok) -> fail(res.message) and restore composer text
   clear pendingFirst
   fail(msg): clear pendingFirst; restore composer text; show inline error bar above the composer (yellow exclamation style, horizontally centered between message list and composer, per AGENTS.md notice placement)
   ```
   `mapCreateError`：`agent_not_found` → 「该智能体已下线或不再分配给你」；`environment_not_found` → 「你的电脑不在该智能体的执行名单中」；`forbidden_scope` → 「企业尚未开放桌面托管会话，请联系管理员」；`enterprise_login_required` → 「请先登录企业账号」；其它 → 「创建会话失败（{{code}}）」。
   `view.sendMessage` 需在 hook 绑定新 sid 后调用：在组件内用 `pendingSendRef` 保存文本，`useEffect` 监听 `view.ready && pane.sessionId === sid` 时发出（避免旧 hook 实例）。
10. **交互式环境保活**：`executionTarget === "desktop_worker"` 且 `pane.sessionId` 非空时，挂载后立即及每 10 分钟调用一次 `POST /api/enterprise-worker/interactive-environments`（失败静默，只 `console.warn`）。
11. 聚焦：根容器 `onMouseDown={onFocus}`；`focused` 时根边框不加粗白框（AGENTS.md：选中态用背景层级）。

### 5.9 主进程 / preload / 类型

`main.ts`（D03 新增 IPC 段之后追加）：

```ts
ipcMain.handle("ma-create-session", async (_event, payload: { agentId?: string; environmentId?: string; title?: string }) => {
  const ep = resolveMaEndpoint(loadAgxConfig());
  if (!ep) return { ok: false, status: 0, code: "enterprise_login_required", message: "请先登录企业账号" };
  const agentId = String(payload?.agentId ?? "");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(agentId)) return { ok: false, status: 400, code: "invalid_request", message: "invalid agent id" };
  const env = payload?.environmentId ? String(payload.environmentId) : "";
  if (env && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(env)) return { ok: false, status: 400, code: "invalid_request", message: "invalid environment id" };
  const body: Record<string, unknown> = { agent_id: agentId, source: "desktop" };
  const title = String(payload?.title ?? "").trim().slice(0, 200);
  if (title) body.title = title;
  if (env) body.environment_id = env;
  return maRequest(ep, "POST", "/sessions", { body });
});
```

`preload.ts`：`maCreateSession: (p: { agentId: string; environmentId?: string; title?: string }) => ipcRenderer.invoke("ma-create-session", p)`。`global.d.ts` 对应声明（返回 D03 定义的 `MaRestResult` 同形类型）。

**改 `main.ts` / `preload.ts` 后必须 ⌘Q 完全退出或 Ctrl+C 重启 `npm run dev`。**

### 5.10 文案（`desktop/locales/zh/sidebar.json`，en 同步）

| 键 | 中文 |
|---|---|
| `gallery.enterprise.title` | 企业智能体 |
| `gallery.enterprise.badge` | 企业 |
| `gallery.enterprise.version` | v{{version}} |
| `gallery.enterprise.pinnedHint` | 管理员固定的版本 |
| `gallery.enterprise.cloud` / `gallery.enterprise.desktop` | 云端执行 / 本机执行 |
| `gallery.enterprise.mine` | 我发布的 |
| `gallery.enterprise.viewDefinition` | 查看定义 |
| `gallery.enterprise.noEnvironment` | 管理员尚未为该智能体指定执行环境 |
| `gallery.enterprise.drawer.*` | 描述 / 执行位置 / 默认云端环境 / 模型 / 系统提示 / 工具与权限 / 内置工具 / 默认策略 / MCP 服务 / 自定义工具 / 由业务系统执行 / 技能 / 欢迎语 / 推荐问题 / 自动执行 / 每次询问 / 已禁用 / 继承默认 / 加载失败，请稍后重试 / 重试 / 请先登录企业账号 / 智能体不存在或未分配给你 |
| `managedPane.newChat` | 新对话 |
| `managedPane.definition` | 定义 |
| `managedPane.close` | 关闭窗格 |
| `managedPane.localBanner` | 本机执行：任务在这台电脑上运行，模型经企业网关调用 |
| `managedPane.placeholder` | 向 {{name}} 提问 |
| `managedPane.requiresAction` | 请先处理待审批的工具调用 |
| `managedPane.send` / `managedPane.stop` | 发送 / 停止 |
| `managedPane.err.*` | 见 §5.8 `mapCreateError` 与 `send` 中的全部中文提示 |

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 专家页「企业已发布」 | 只读 chip（名称 + 执行位置） | 可点击卡片：企业徽标、版本、执行位置、查看定义 |
| 打开企业 Agent | 不可对话 | 托管窗格；云端或本机执行 |
| `/api/desktop/agents` | 8 键 | 8 键不变 + 6 个新键 |
| 个人分身 / Machi 窗格 | `ChatPane` | 不变 |

---

## 7. FR / NFR / AC

| ID | 需求 | AC（文件 :: 用例 → 断言） |
|---|---|---|
| FR-W1 | 列表增量字段 | `web-portal/.../agents/__tests__/route.test.ts`（vi.mock `@agenticx/iam-core` 与 `desktop-auth`）：`keeps legacy keys and adds managed fields`（元素前 8 键值与改动前一致；`effectiveVersion` 取 `getAgentWithMa` 的值；`defaultEnvironment.name` 正确；`executionTarget` 取环境类型）；`falls back when enrichment fails`（`listAgentsWithMa` 抛错 → 200，`latestVersion === 1`、`defaultEnvironment === null`、`executionTarget === runtime`）；`marks ownedByMe for own employee agents`；`returns 401 without identity` |
| FR-W2 | 详情路由 | `detail-route.test.ts`：`returns 404 for agents not assigned to the viewer`（`listAgentsVisibleToKeys` 不含该 id → 404，`getAgentVersion` 未调用）；`returns 404 for malformed id`；`returns summary of effective version`（`getAgentVersion` 第三参等于 `effectiveVersion`）；`summary never contains mcp urls`（`JSON.stringify(body)` 不含 manifest 中的 `https://mcp.example.com/`） |
| FR-W3 | 摘要函数 | `desktop-agent-catalog.test.ts::buildManifestSummary`：完整 manifest（含 agx_builtin、mcp、custom、skills、runtime、metadata）→ 各字段正确；`null` / 非对象 → 空结构不抛；`policy: null` 的 config 输出 `null` |
| FR-P1 | Python 透传与详情 | `tests/test_enterprise_agent_catalog_d02.py`（`httpx.MockTransport` 不可直接注入 `httpx.get`：用 `monkeypatch.setattr(httpx, "get", fake)`）：`test_fetch_published_agents_passes_new_fields`（门户返回带 `effectiveVersion`、`defaultEnvironment` 的元素 → 原样出现在结果中）；`test_detail_not_logged_in`（未登录 → 路由 409）；`test_detail_404_and_502`（门户 404 → 路由 404；门户 500 → 502）；`test_detail_rejects_bad_id`（`abc` → 400）；`test_detail_ok`（200 原样返回）。路由测试用 FastAPI app + `register_enterprise_worker_routes(app, check_token=lambda _t: None)` 构造 |
| FR-D1 | 窗格 id 与最近会话 | `desktop/src/utils/ma-pane.test.ts`：`isManagedPaneAvatarId`（`ma:<ULID>` true；`ma:bad`、`group:x`、null false）；`remember/get/forget`（用内存 `Storage` 替身）；`evicts oldest beyond 100`；`parseEnterpriseAgents falls back for legacy payload`（只有 8 个旧键 → `effectiveVersion === 1`、`executionTarget === runtime`） |
| FR-D2 | 企业区块 | `EnterpriseAgentSection.test.tsx`：`renders badge, version and execution label`；`clicking a card opens the managed pane`（mock `usePaneNavigation` → `openManagedAgentPane` 收到该卡片）；`definition button opens drawer without opening pane`；`desktop agent without environment is disabled`；`returns null for empty list` |
| FR-D3 | 云端会话创建 | `ManagedChatPane.test.tsx::creates a cloud session on first send`（mock `studioFetch` 返回 cloud 卡片；`maCreateSession` 返回 `{ok:true,data:{id:SID,agent_version:2,...}}`）：输入「你好」回车 → 输入框立即清空、出现待发送气泡；`maCreateSession` 参数 `{agentId, environmentId: undefined, title: "报告助手"}`；store 中该窗格 `sessionId === SID`；`localStorage["agx-ma-last-session-v1"][agentId].sessionId === SID`；随后 `maPostEvents` 收到 `user.message` |
| FR-D4 | 本机执行 | `ManagedChatPane.test.tsx::registers interactive environment before creating a desktop session`：desktop_worker 卡片 → 先 `POST /api/enterprise-worker/interactive-environments`（body `{"environment_id": ENV}`），再 `maCreateSession({environmentId: ENV})`；交互式注册返回 409 → 不调用 `maCreateSession`，显示「请先登录企业账号」，输入框文本恢复 |
| FR-D5 | 创建失败映射 | `ManagedChatPane.test.tsx::maps create errors`：`environment_not_found` → 「你的电脑不在该智能体的执行名单中」；`forbidden_scope` → 「企业尚未开放桌面托管会话，请联系管理员」 |
| FR-D6 | 恢复与失效会话 | `ManagedChatPane.test.tsx::drops a stale remembered session`：窗格 `sessionId` 预置、`maGetSession` 返回 404 → 窗格 `sessionId` 变为 `""`，最近会话被清除，显示空态欢迎语 |
| FR-D7 | 运行中停止 / 待审批禁用 | `ManagedChatPane.test.tsx::shows stop while running and blocks input on requires_action`（mock `useManagedSession` 返回对应 `transcript.status`） |
| FR-D8 | 头部身份 | `ManagedChatPane.test.tsx::header shows enterprise identity`：含名称、「企业」、`v2`；不含「分身」 |
| FR-D9 | 窗格分流 | `desktop/src/components/PaneManager` 无独立测试：在 `ManagedChatPane.test.tsx` 追加 `PaneManager renders ManagedChatPane for ma panes`（渲染 PaneManager 并预置一个 `ma:` 窗格与一个普通窗格，断言前者出现 `data-testid="managed-chat-pane"`、后者仍是 ChatPane 根节点 testid——若 ChatPane 无 testid，用 `vi.mock("./ChatPane")` 替身断言被调用次数为 1） |
| FR-D10 | IPC 参数校验 | `desktop/tests/ma-session-client.test.ts`（D03 文件追加）`create session body`：把 §5.9 的 body 组装抽成 `buildCreateSessionBody(payload)` 纯函数放进 `ma-session-client.ts` 并测试：非 ULID agentId → 错误；title 截断 200；`source === "desktop"`；无 env 不出现 `environment_id` 键 |
| NFR-1 | 个人模式不变 | `git diff --quiet -- desktop/src/components/ChatPane.tsx desktop/src/components/ChatView.tsx desktop/src/components/AvatarSidebar.tsx`；`npm -C desktop test` 全绿 |
| NFR-2 | `agx serve` 冷启动 smoke | `enterprise_worker_routes.py` 被 `server.py` 顶层导入 → §8 smoke 必跑 |
| NFR-3 | `server.py` 零改动 | `git diff --quiet -- agenticx/studio/server.py` |
| NFR-4 | 构建 | `npm -C desktop run build`；`pnpm -C enterprise --filter @agenticx/app-web-portal typecheck` |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pnpm -C enterprise --filter @agenticx/app-web-portal test -- src/app/api/desktop/agents src/lib/desktop-agent-catalog.test.ts
pnpm -C enterprise --filter @agenticx/app-web-portal typecheck
pytest tests/test_enterprise_agent_catalog_d02.py tests/test_enterprise_worker_routes.py -q --no-cov
python -c "import agenticx.studio.server; print('imports ok')"
git diff --quiet -- agenticx/studio/server.py && echo "server.py untouched"
npm -C desktop test -- src/utils/ma-pane.test.ts src/components/gallery src/components/managed tests/ma-session-client.test.ts src/i18n/message-parity.test.ts
npm -C desktop test
npm -C desktop run build
```

`agx serve` 冷启动 smoke（同 MA-D01 §8，路径追加 `/api/enterprise-agents`，未登录企业时期望 200 `{"agents": []}`）。

改 `main.ts` / `preload.ts` 后 ⌘Q 完全退出 Near 或 Ctrl+C 重启 `npm run dev`。

**W3 门演示（本文部分；需 E01–E03、D01、D03 已合入，agent-runtime 开 `MA_RUNTIME_DESKTOP_PAT_ENABLED=1`、`MA_RUNTIME_DESKTOP_WORKER_ENABLED=1`）：**
1. admin-console 新建 cloud Agent「报告助手」（`bash_exec: always_ask`），分配给自己，发布 v1、v2，路由固定 v1。
2. Near 登录企业，⌘Q 重启；侧栏「专家」→ 企业智能体区块出现「报告助手 · 企业 · v1 · 云端执行」；点「查看定义」抽屉显示 `bash_exec` 每次询问。
3. 点卡片 → 托管窗格，发「列出当前目录」→ 收件箱角标 +1 且会话内出现确认卡，批准后看到工具结果与最终回复；窗格头显示 v1。
4. 关闭窗格再从卡片打开 → 回到同一会话历史。
5. 一个 `desktop_worker` 默认环境的 Agent（执行名单含自己）→ 卡片「本机执行」，对话后 `~/.agenticx/sessions/<sid>/work` 出现产物；设置 → 企业 Worker「运行中的任务」显示来源「本机对话」。
6. 退出企业登录 → 区块消失；Machi 与本地分身对话不受影响。

---

## 9. 回滚

- 无运行时开关：web-portal 新字段为增量，旧 Near 忽略；Desktop 回滚 = 删除新建文件、`git checkout` 修改文件；`AvatarGalleryView` 恢复为 chip。
- 已持久化的 `ma:` 窗格在回滚版本里会作为普通窗格渲染（`ChatPane` 找不到本地会话，显示空会话）；回滚说明中提示用户关闭这些窗格，或回滚前由实施者确认 `addPane` 恢复逻辑对未知 `avatarId` 无崩溃（AC 外的人工检查项）。
- agent-runtime 侧关闭 `MA_RUNTIME_DESKTOP_PAT_ENABLED` → 创建会话返回 403，窗格显示「企业尚未开放桌面托管会话」。

---

## 10. 不变量

1. 未登录企业：专家页不显示企业区块（与现状一致：`fetch_published_agents` 返回 `[]`）；不发出任何 MA 请求。
2. `ChatPane.tsx`、`ChatView.tsx`、`AvatarSidebar.tsx`、`server.py` 零改动；Machi / 分身 / 群聊窗格行为不变。
3. `/api/desktop/agents` 原 8 个键的取值与过滤规则不变；`/api/desktop/agents/register` 不变。
4. 托管窗格不把 `ma:` id 写入「当前分身」，不调用本机 `/api/session*` 接口。
5. 设备 PAT 不进入渲染进程。

---

## 11. 风险

1. **`desktop_worker` 交互式依赖本机 Worker 在线**：Near 的 `agx serve` 未启动或企业 Worker 授权不满足时，会话停在 queued，表现为一直「正在处理…」。窗格在 `status` 长时间（60 秒）为 idle 且无新事件时显示提示「本机执行尚未开始，请在设置 → 企业 Worker 查看状态」（实现为 `ManagedChatPane` 内计时器；写入 FR-D7 同文件的追加用例 `warns when local execution does not start`）。
2. **窗格恢复路径**：工作区快照恢复 `ma:` 窗格时，若 App 层某处对所有窗格调用本机会话接口，会产生无害 404 噪音；§3.1 条件性修改项负责消除。
3. **目录富化性能**：`listAgentsWithMa` 与 `listMaEnvironments` 每次全量查询；员工目录规模（几十个）可接受。
4. **托管会话无会话列表**：换设备或清 localStorage 后找不回旧会话（服务端仍保留）；后续可加 `GET /ma/v1/sessions?mine=1`（需改冻结契约）。

---

## 12. 待确认问题

- **Q1（栈规则）**：web-portal 的增量字段与详情路由（TS）超出 master §0 规则 1。可选替代：把这两处拆为独立小子规划（与 MA-D04 的门户路由合并为一个「桌面 BFF 扩展」子规划）。是否接受在本文内完成？
- **Q2（侧栏落点）**：master 写「侧栏展示」，本文落在侧栏「专家」导航进入的专家页（D2）。如需在侧栏导航本身增加「企业智能体」列表，请明确，以便调整 `AvatarSidebar.tsx` 的范围。
- **Q3**：托管会话标题固定为 Agent 名称（会话面无改名接口）。是否需要用首条消息摘要作标题（需 agent-runtime 支持更新 `title`，冻结契约无此接口）？
