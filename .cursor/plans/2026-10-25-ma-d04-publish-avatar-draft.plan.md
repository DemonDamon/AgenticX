# MA-D04 本地分身「发布到企业」：导出 Manifest、按员工分身幂等提交草稿版本

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W3 · MA-D04，可与 W2 并行）
Depends-on:
- MA-00（已实现：`agenticx/managed/manifest.py` 的 `validate_manifest` / `normalize_manifest`）
- MA-A01（已实现：`agenticx/managed/spec.py` 的 `MANAGED_BUILTIN_TOOLS`、`compile_spec`）
- MA-E01 / MA-E02（已实现：iam-core `createAgentWithInitialVersion`、`createAgentVersion`、`previewAgentManifest`、`getAgentVersion`、`listAgentsWithMa`、`getAgentWithMa`、`updateAgentMaSettings`；版本来源 `desktop`）

> 风险等级：中。
>
> **栈说明（偏离 master §0 规则 1，须用户确认，见 §12 Q1）**：Python（Manifest 导出 + `agx serve` 路由）+ Desktop（分身设置面板新 tab）+ web-portal TS（1 个新路由）。设备 PAT 没有 `ma:agents:write`，且公共 `POST /api/ma/v1/agents` 只能建 `origin=enterprise` 的 Agent、不能按「员工 + 本机分身 id」幂等，因此必须有一个设备侧门户路由。

---

## 0. 一句话目标

在分身设置面板新增「企业」tab：预览把这个本地分身导出成 `agx.agent/v1` Manifest 的结果（剥离密钥与本机路径、把本地工具映射到托管内置工具白名单、说明技能 / MCP 不随版本发布），确认后提交到企业：首次提交创建 `origin=employee`、`lifecycle=draft` 的企业 Agent 与 v1；之后每次提交按 `(员工, local_avatar_id)` 幂等追加新版本（内容不变则不新建），对已发布且「跟随最新」的 Agent 先把路由固定在当前生效版本，使新版本只作为待管理员发布的候选。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 本文落点 |
|---|---|---|
| §2.2 | 桌面拥有「本地分身发布为企业 Agent 草稿」 | 本文 |
| §4 决策 7 | 每次更新产生不可变版本；渠道可跟随最新或固定版本 | §5.4 固定路由规则 |
| §4 决策 8 / §5.1 | Manifest 严格校验；**不得出现任何密钥**；MCP 条目不得带 `headers` / `env` | §5.2 清洗 + 本地 `validate_manifest` |
| §12 变更记录 | 托管内置工具白名单 14 个（`MANAGED_BUILTIN_TOOLS`）；Manifest 未列出的工具一律 deny | §5.2 工具映射 |
| §9 MA-D04 行 | 导出 Manifest（剥离密钥与本地路径），技能打包上传，生成 draft 版本；复用 `POST /api/desktop/agents/register` 并扩展字段 | §2 D2、D3 解释偏离 |
| §1.3 / §4 决策 9 | 个人模式不变 | §10 |

### 1.2 现状代码证据（实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/avatar/registry.py` | 110–132 | `AvatarConfig` 字段：`id, name, role, system_prompt, description, tags, default_provider, default_model, tools_enabled: Dict[str,bool], skills_enabled: Optional[Dict[str,bool]], brains_enabled, workspace_dir, ...` | 导出来源 |
| 同上 | 285、365、449、466–471 | `get_avatar(id)`；`create_avatar` / `update_avatar` 末尾 `_sync_enterprise(config)` → `sync_local_avatar` | 已有「自动登记」路径（见 1.3） |
| `agenticx/runtime/enterprise_agent_sync.py` | 19–33、36–67 | `_settings()`；`sync_local_avatar` POST `/api/desktop/agents/register`，字段 `local_avatar_id, display_name, system_prompt, model, description` | 不改；本文另走 publish |
| `agenticx/studio/server.py` | 1780–1787、1811–1816、1853–1874 | `_sanitize_tools_enabled`；全局 `tools_enabled` 读 `ConfigManager.get_value("tools_enabled")`；生效规则：分身键优先，其次全局键，**缺省为允许** | 工具映射复用同一优先级 |
| `agenticx/managed/spec.py` | 20–24、169–190 | `MANAGED_BUILTIN_TOOLS`（14 个）；`agx_builtin` 工具集对白名单内每个工具按 `configs` / `default_policy` 生成，`enabled:false` 移除 | 映射目标 |
| `agenticx/managed/manifest.py` | 20–41、180–191、357–377、410–420、448–515 | `MAX_MANIFEST_BYTES=262144`、`MAX_SYSTEM_BYTES=65536`、`MODEL_RE=^[^/\s]+/\S+$`；config 只允许 `name/policy/enabled`；skills 只允许 `source∈{builtin,tenant}` + `id` + `version`；`normalize_manifest` 剥离 `metadata.{model,description,agentName}` | 本地先校验，与企业侧同口径 |
| `agenticx/runtime/credential_store.py` | 26、268–292 | `CRED_REF_RE = \$\{cred:([A-Z][A-Z0-9_]{1,63})\}`；`redact_text(text)` 把本机已存密钥明文替换为 `[REDACTED:NAME]` | 系统提示清洗 |
| `agenticx/studio/attachment_routing.py` | 182–193 | 企业登录后 Near 的模型挂在 provider `enterprise` 下，模型名是全 id（`<provider>/<model>`） | 模型映射特例 |
| `enterprise/apps/web-portal/src/app/api/desktop/agents/register/route.ts` | 1–34 | `registerEmployeeAgent(...)`；响应 `{id, lifecycle, origin}` | 不改（E01 不变量） |
| `enterprise/packages/iam-core/src/repos/agents.ts` | 727–768 | `registerEmployeeAgent`：按 `origin==="employee" && ownerUserId && localAvatarId` 查找；新建时 `runtime:"desktop_worker"`、`assignmentKeys/workerKeys:[owner]`、**`lifecycle:"published"`** | 自动登记会直接发布；本文的 publish 必须与之共存（D4） |
| 同上 | 621–665、667–716 | `updateAgentMaSettings(tenant, id, {versionRouting, pinnedVersion})`；`createAgentWithInitialVersion(tenant, AgentInput, {manifest, note, createdBy, source:"admin"|"api"|"desktop"})` | 新建草稿 |
| `enterprise/packages/iam-core/src/repos/agent-versions.ts` | 81–145、148–155、158–165 | `createAgentVersion(tenant, id, {manifest, expectedLatestVersion, note, createdBy, source})` → `{version, created}`（内容哈希相同返回 `created:false`）；`previewAgentManifest(tenant, manifest)` → `{ok, normalized, manifestHash}`；`getAgentVersion` | 幂等与候选版本 |
| `enterprise/packages/iam-core/src/repos/agents.ts` | 60–76 | `AgentInput` 含 `ownerUserId`、`localAvatarId`、`lifecycle`、`origin` | 新建草稿可带员工归属 |
| `desktop/src/components/AvatarSettingsPanel.tsx` | 77、79–81、84、385–395、419–436、439 | `type Tab = "general" \| "tools" \| "skills" \| "soul"`；`useTranslation("settings")`；分身模式 tabs 三项；tab 栏与内容区 | 追加 `enterprise` tab |
| `desktop/locales/zh/settings.json` | 976–990 | `avatar` 文案节 | 新文案 |

### 1.3 现状的问题

- 自动登记（`sync_local_avatar`）只同步名称 / 系统提示 / 模型三列，**没有工具权限、没有 Manifest**，并且新建即 `published`；员工无法控制「何时、以什么定义」交给企业。
- master 要求的是「发布为草稿版本」：有完整 Manifest、经企业侧同口径校验、由管理员决定是否生效。

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 新增门户路由 `POST /api/desktop/agents/publish`，**不扩展** `/register` | E01 不变量要求 `/register` 行为与响应不变；两条语义不同（自动同步三列 vs 显式提交版本），混在一个路由里会让旧 Near 客户端行为不可预测 |
| D2 | 不用公共 `POST /api/ma/v1/agents` | 设备 PAT 无 `ma:agents:write`；公共接口固定 `origin:"enterprise"`、无 `owner_user_id` / `local_avatar_id`，无法按员工分身幂等 |
| D3 | **技能首版不打包上传**：`skills: []`，面板明确告知「本机技能不随版本发布，企业技能需管理员在技能库上架后在管理台添加」 | Manifest 只能引用企业技能库（`source:"tenant"` + ULID）或内置技能；仓库没有「员工上传技能到企业技能库」的接口与审核链路，技能含可执行脚本，直接上传绕过企业审核是安全问题；做这条链路需要独立子规划（见 §12 Q2） |
| D4 | 幂等键 = `(tenant, ownerUserId, localAvatarId, origin="employee")`，与 `registerEmployeeAgent` 同一查找规则：不存在 → 新建 `draft` Agent + v1；存在 → 追加版本（`source:"desktop"`）；内容哈希等于最新版本 → 不新建（`created:false`），也不改路由 | 重复点击 / 网络重试安全 |
| D5 | 已存在、`lifecycle==="published"` 且 `versionRouting==="follow_latest"` 时，**先**把路由固定到当前 `effectiveVersion`，再追加新版本 | 否则新版本立即对已分配员工生效，违背「草稿 / 候选」语义；固定后管理员在 E02 版本页一键切换 |
| D6 | `lifecycle==="recalled"` → 409 拒绝提交 | 管理员已回收，员工不得自行恢复（与 `registerEmployeeAgent` 注释「回收后的记录不会被这次同步重新发布」一致） |
| D7 | 工具映射：对白名单 14 个工具按「分身键 → 全局键 → 缺省允许」得出启用状态；禁用的写 `{"name", "enabled": false}`；`bash_exec`、`file_write`、`file_edit` 写 `{"name", "policy": "always_ask"}`；其余继承 `default_policy: "always_allow"`；分身里显式开启但不在白名单的工具列入「未纳入」 | 白名单外工具在托管模式一律 deny（master §12）；写操作默认询问，管理员可在 E02 编辑器放宽 |
| D8 | 系统提示清洗：`${cred:NAME}` → `[凭证引用已移除:NAME]`；`redact_text`；通用密钥模式（`agx-pat-…`、`sk-…`、`Bearer …`、`AKIA…`）→ `[REDACTED]`；家目录前缀 → `~`（`/Users/<name>`、`/home/<name>`、`C:\Users\<name>`）；报告中列出计数，不回显被移除的值 | master §5.1「Manifest 内不得出现任何密钥」与「剥离本地路径」 |
| D9 | 模型映射：`default_provider == "enterprise"` 且 `default_model` 含 `/` → 原样用 `default_model`；否则 `f"{provider}/{model}"`；任一为空 → 错误「请先在『基本信息』里为分身设置默认模型」；提示「企业模型服务中需存在同名模型，管理员可在发布前调整」 | 与 Near 企业 provider 的命名一致；本机 provider 名不一定在企业网关存在 |
| D10 | MCP：`mcp_servers: []`，`tools` 不含 `mcp` 项；面板提示「本机 MCP 服务不随版本发布」 | 本机 MCP 多为 stdio 或带本机凭证，Manifest 只允许无凭证的 http/sse URL，凭证要经 Vault（MA-E06） |
| D11 | 提交的是**已保存**的分身配置（从 `AvatarRegistry` 读），面板顶部提示「如有未保存的修改，请先在其它 tab 保存」 | 避免把未确认的草稿态提交给企业 |

---

## 3. In scope / Out of scope

### 3.1 In scope

**Python**
- 新建 `agenticx/runtime/enterprise_agent_publish.py`
- 修改 `agenticx/studio/enterprise_worker_routes.py`（追加 1 个路由；该模块已被 `server.py:118` 导入注册）
- 新建 `tests/test_enterprise_agent_publish.py`
- 新建 `tests/test_enterprise_agent_publish_route.py`

**web-portal（TS）**
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/publish/route.ts`
- 新建 `enterprise/apps/web-portal/src/lib/desktop-agent-publish.ts`（业务逻辑，便于单测）
- 新建 `enterprise/apps/web-portal/src/lib/desktop-agent-publish.test.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/publish/__tests__/route.test.ts`

**Desktop**
- 新建 `desktop/src/components/AvatarEnterprisePublishTab.tsx`
- 新建 `desktop/src/components/AvatarEnterprisePublishTab.test.tsx`
- 修改 `desktop/src/components/AvatarSettingsPanel.tsx`（`Tab` 类型、tabs 列表、内容分支、企业登录态）
- 修改 `desktop/locales/zh/settings.json`、`desktop/locales/en/settings.json`（`avatar.enterprise*` 新键）

### 3.2 Out of scope

- `agenticx/studio/server.py`（零改动）、`agenticx/avatar/registry.py`（`_sync_enterprise` 不改）、`agenticx/runtime/enterprise_agent_sync.py`。
- web-portal `/api/desktop/agents/register`、iam-core 全部（只调用现有导出）、admin-console。
- 技能打包上传、MCP / 凭证随版本发布、Machi（Meta）发布、群聊发布。
- 修改「自动登记即发布」的旧行为（见 §12 Q3）。

---

## 4. 数据与协议

### 4.1 门户 `POST /api/desktop/agents/publish`

鉴权：`resolveDesktopIdentity`（设备 PAT），失败 → `workerUnauthorized()`。请求体（JSON object，未知键 → 400）：

```json
{
  "local_avatar_id": "a1b2c3d4-…",
  "display_name": "周报助手",
  "description": "帮团队整理周报",
  "manifest": { "schema": "agx.agent/v1", "model": "deepseek/deepseek-chat", "system": "…", "tools": [ … ], "mcp_servers": [], "skills": [], "multiagent": null, "runtime": { "max_tool_rounds": 40, "max_session_tokens": null }, "metadata": { "welcome_message": "…", "suggested_questions": [] } },
  "note": "第一次提交"
}
```

校验：`local_avatar_id` 匹配 `^[A-Za-z0-9._-]{1,128}$`；`display_name` 去空白后 1–64 字符；`description` 为 string（≤500）或 null / 缺省；`manifest` 必须为对象；`note` 为 string（≤500）或缺省。失败 → 400 `{"code":"40000","message":"<中文原因>"}`。

响应：

| 情况 | HTTP | 体 |
|---|---|---|
| 新建草稿 | 201 | `{"agent_id","version":1,"created":true,"lifecycle":"draft","routing_mode":"follow_latest","effective_version":1}` |
| 追加新版本 | 201 | `{"agent_id","version":N,"created":true,"lifecycle":<现值>,"routing_mode":<现值>,"effective_version":<现值>}` |
| 内容未变 | 200 | 同上形状，`created:false`，`version` = 最新版本号 |
| Manifest 不合法 | 400 | `{"code":"40001","message":"manifest is invalid","errors":["manifest.model: is required", …]}` |
| 已回收 | 409 | `{"code":"40900","message":"该智能体已被管理员回收，无法再次提交"}` |
| 版本冲突重试仍失败 | 409 | `{"code":"40901","message":"企业侧版本刚被更新，请稍后重试"}` |
| 其它 | 走 `workerErrorResponse(error)` | — |

### 4.2 本机 Studio `POST /api/avatars/{avatar_id}/enterprise-publish`

请求：`{"dry_run": bool = true, "note": str | null}`（`note` ≤500，超长 400）。

| 情况 | HTTP | 体 |
|---|---|---|
| 分身不存在 | 404 | `detail="avatar not found"` |
| 未登录企业 | 409 | `detail="enterprise_login_required"` |
| 导出有错误（如缺模型、Manifest 本地校验失败） | 200 | `{"ok":false,"error":"manifest_invalid","message":"<首条错误>","manifest":…,"report":…}` |
| `dry_run=true` | 200 | `{"ok":true,"dry_run":true,"manifest":…,"report":…}` |
| 提交成功 | 200 | `{"ok":true,"dry_run":false,"manifest":…,"report":…,"result":{…§4.1 成功体…}}` |
| 门户返回非 2xx | 200 | `{"ok":false,"error":"publish_failed","message":"HTTP <status> · <门户 message>","status":<status>,"errors":[…门户 errors…],"report":…}` |
| 网络失败 | 200 | `{"ok":false,"error":"publish_failed","message":"无法连接企业服务","status":0,"report":…}` |

`report` 结构：

```json
{
  "model": "deepseek/deepseek-chat",
  "included_tools": [{ "name": "bash_exec", "policy": "always_ask" }, { "name": "file_read", "policy": "always_allow" }],
  "disabled_tools": ["web_search"],
  "excluded_tools": [{ "name": "knowledge_search", "reason": "托管模式不支持该工具" }],
  "removed_credential_refs": ["GITHUB_TOKEN"],
  "redacted_secrets": 1,
  "replaced_local_paths": 2,
  "warnings": ["本机技能不随版本发布……", "本机 MCP 服务不随版本发布……", "企业模型服务中需存在 deepseek/deepseek-chat……"],
  "errors": []
}
```

`included_tools` 只含启用的白名单工具（按 `MANAGED_BUILTIN_TOOLS` 顺序），`policy` 为生效策略。

---

## 5. 精确落点

### 5.1 `agenticx/runtime/enterprise_agent_publish.py`（新建）

```python
#!/usr/bin/env python3
"""Export a local avatar as an agx.agent/v1 manifest and submit it as an enterprise draft version.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping

import httpx

from agenticx.avatar.registry import AvatarConfig
from agenticx.cli.config_manager import ConfigManager
from agenticx.managed.manifest import MAX_MANIFEST_BYTES, MAX_SYSTEM_BYTES, validate_manifest
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec
from agenticx.managed.errors import MAError
from agenticx.runtime.credential_store import CRED_REF_RE, redact_text

ASK_BY_DEFAULT: tuple[str, ...] = ("bash_exec", "file_write", "file_edit")
DEFAULT_MAX_TOOL_ROUNDS = 40
ENTERPRISE_PROVIDER = "enterprise"
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"agx-pat-[A-Za-z0-9._-]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)
HOME_PATH_RE = re.compile(r"(?:/Users/[^/\s]+|/home/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)")
WARN_SKILLS = "本机技能不随版本发布；企业技能需管理员在企业技能库上架后，在管理台为该智能体添加"
WARN_MCP = "本机 MCP 服务不随版本发布；需要的 MCP 由管理员在管理台配置"
WARN_MODEL = "企业模型服务中需存在模型 {model}；如不存在，管理员可在发布前调整"
ERR_NO_MODEL = "请先在「基本信息」里为分身设置默认模型"
ERR_NOT_LOGGED_IN = "enterprise_login_required"


@dataclass
class PublishReport:
    model: str = ""
    included_tools: list[dict[str, str]] = field(default_factory=list)
    disabled_tools: list[str] = field(default_factory=list)
    excluded_tools: list[dict[str, str]] = field(default_factory=list)
    removed_credential_refs: list[str] = field(default_factory=list)
    redacted_secrets: int = 0
    replaced_local_paths: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EnterprisePublishError(Exception):
    def __init__(self, status: int, message: str, errors: list[str] | None = None) -> None: ...


def sanitize_system_prompt(text: str) -> tuple[str, list[str], int, int]:
    """Return (clean_text, removed_credential_ref_names, redacted_secret_count, replaced_path_count)."""


def resolve_manifest_model(provider: str, model: str) -> str | None: ...


def effective_tool_enabled(name: str, avatar_tools: Mapping[str, bool], global_tools: Mapping[str, bool]) -> bool:
    """Avatar key wins, then global key, default True (same rule as server._filter_tools_by_policy)."""


def load_global_tools_enabled() -> dict[str, bool]:
    """ConfigManager.get_value('tools_enabled') sanitized to {str: bool}; errors -> {}."""


def build_publish_manifest(
    avatar: AvatarConfig,
    *,
    global_tools_enabled: Mapping[str, bool],
) -> tuple[dict[str, Any], PublishReport]: ...


def enterprise_publish_settings() -> tuple[str, str] | None:
    """(token, base_url) when enterprise.enabled is True and token/base_url non-empty (same rule as enterprise_agent_sync._settings)."""


def publish_avatar_draft(
    avatar: AvatarConfig,
    manifest: Mapping[str, Any],
    note: str | None,
    *,
    settings: tuple[str, str],
    http_post: Any = httpx.post,
) -> dict[str, Any]:
    """POST {base}/api/desktop/agents/publish; 2xx -> response JSON; else EnterprisePublishError(status, message, errors)."""
```

**`sanitize_system_prompt(text)`（顺序固定）**：

```text
refs = sorted(set(CRED_REF_RE.findall(text)))
text = CRED_REF_RE.sub(lambda m: f"[凭证引用已移除:{m.group(1)}]", text)
marks_before = text.count("[REDACTED:")
text = redact_text(text)
secrets = text.count("[REDACTED:") - marks_before
for pattern in SECRET_PATTERNS: text, n = pattern.subn("[REDACTED]", text); secrets += n
text, paths = HOME_PATH_RE.subn("~", text)
return text, refs, secrets, paths
```

（`redact_text` 新增的替换数 = 处理后 `text.count("[REDACTED:")` 减处理前计数。）

**`resolve_manifest_model(provider, model)`**：两者 strip；`model` 为空 → None；`provider == "enterprise"` 且 `"/" in model` → `model`；`provider` 为空 → None；否则 `f"{provider}/{model}"`。

**`build_publish_manifest(avatar, global_tools_enabled)`**：

```text
report = PublishReport()
model = resolve_manifest_model(avatar.default_provider, avatar.default_model)
if model is None: report.errors.append(ERR_NO_MODEL); model = ""
report.model = model
system, refs, secrets, paths = sanitize_system_prompt(avatar.system_prompt or "")
report.removed_credential_refs = refs; report.redacted_secrets = secrets; report.replaced_local_paths = paths
if len(system.encode("utf-8")) > MAX_SYSTEM_BYTES: report.errors.append("系统提示超过 64 KiB，请精简后再提交")
avatar_tools = {str(k): bool(v) for k, v in (avatar.tools_enabled or {}).items()}
configs = []
for name in MANAGED_BUILTIN_TOOLS:
    if not effective_tool_enabled(name, avatar_tools, global_tools_enabled):
        configs.append({"name": name, "enabled": False}); report.disabled_tools.append(name); continue
    if name in ASK_BY_DEFAULT:
        configs.append({"name": name, "policy": "always_ask"}); report.included_tools.append({"name": name, "policy": "always_ask"})
    else:
        report.included_tools.append({"name": name, "policy": "always_allow"})
for name, on in sorted(avatar_tools.items()):
    if on and name not in MANAGED_BUILTIN_TOOLS:
        report.excluded_tools.append({"name": name, "reason": "托管模式不支持该工具"})
welcome, _, _, _ = sanitize_system_prompt((avatar.description or "").strip()[:500])
manifest = {
  "schema": "agx.agent/v1", "model": model, "system": system,
  "tools": [{"type": "agx_builtin", "default_policy": "always_allow", "configs": configs}],
  "mcp_servers": [], "skills": [], "multiagent": None,
  "runtime": {"max_tool_rounds": DEFAULT_MAX_TOOL_ROUNDS, "max_session_tokens": None},
  "metadata": {"welcome_message": welcome, "suggested_questions": []},
}
report.warnings += [WARN_SKILLS, WARN_MCP] + ([WARN_MODEL.format(model=model)] if model else [])
if not report.errors:
    result = validate_manifest(manifest)
    if not result.ok: report.errors.extend(result.errors)
    else:
        try: compile_spec("draft", 1, manifest)
        except MAError as err: report.errors.extend(err.details.get("errors", []) or [err.message])
if len(json.dumps(manifest, ensure_ascii=False).encode("utf-8")) > MAX_MANIFEST_BYTES:
    report.errors.append("Manifest 超过 256 KiB")
return manifest, report
```

（`ManifestResult` 的字段名 `ok` / `errors` 以 `agenticx/managed/manifest.py:517` 实际定义为准。）

**`publish_avatar_draft`**：

```python
token, base = settings
body = {"local_avatar_id": avatar.id, "display_name": avatar.name.strip()[:64],
        "description": (avatar.description or "").strip()[:500] or None,
        "manifest": dict(manifest)}
if note: body["note"] = note
try:
    resp = http_post(f"{base}/api/desktop/agents/publish", headers={"Authorization": f"Bearer {token}"},
                     json=body, timeout=15.0, trust_env=False)
except httpx.HTTPError as exc:
    raise EnterprisePublishError(0, "无法连接企业服务") from exc
if 200 <= resp.status_code < 300: return resp.json()
payload = resp.json() if <content-type json> else {}
raise EnterprisePublishError(resp.status_code, str(payload.get("message") or f"HTTP {resp.status_code}"),
                             [str(e) for e in payload.get("errors") or []])
```

`trust_env=False` 与 `enterprise_agent_sync.py:61` 惯例一致。日志不得包含 token 或 Manifest 全文。

### 5.2 Studio 路由（`agenticx/studio/enterprise_worker_routes.py` 追加）

```python
class EnterprisePublishRequest(BaseModel):
    dry_run: bool = True
    note: Optional[str] = Field(default=None, max_length=500)


    @app.post("/api/avatars/{avatar_id}/enterprise-publish")
    async def publish_avatar_to_enterprise(avatar_id: str, payload: EnterprisePublishRequest,
                                           x_agx_desktop_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        avatar = AvatarRegistry().get_avatar(avatar_id)
        if avatar is None:
            raise HTTPException(status_code=404, detail="avatar not found")
        settings = enterprise_publish_settings()
        if settings is None:
            raise HTTPException(status_code=409, detail="enterprise_login_required")
        manifest, report = build_publish_manifest(avatar, global_tools_enabled=load_global_tools_enabled())
        if report.errors:
            return {"ok": False, "error": "manifest_invalid", "message": report.errors[0],
                    "manifest": manifest, "report": report.to_dict()}
        if payload.dry_run:
            return {"ok": True, "dry_run": True, "manifest": manifest, "report": report.to_dict()}
        try:
            result = await asyncio.to_thread(publish_avatar_draft, avatar, manifest,
                                             (payload.note or "").strip() or None, settings=settings)
        except EnterprisePublishError as err:
            return {"ok": False, "error": "publish_failed",
                    "message": f"HTTP {err.status} · {err.message}" if err.status else err.message,
                    "status": err.status, "errors": err.errors, "report": report.to_dict()}
        return {"ok": True, "dry_run": False, "manifest": manifest, "report": report.to_dict(), "result": result}
```

顶部 import 追加：`asyncio`、`HTTPException`、`Field`（pydantic）、`from agenticx.avatar.registry import AvatarRegistry`、`from agenticx.runtime.enterprise_agent_publish import (EnterprisePublishError, build_publish_manifest, enterprise_publish_settings, load_global_tools_enabled, publish_avatar_draft)`。若 MA-D01 / MA-D02 已在本文件追加过同名 import，合并而不重复。

**导入链检查**：`enterprise_agent_publish.py` import `agenticx.managed.spec`（会导入 `agenticx.cli.agent_tools` 的 `STUDIO_TOOLS`）与 `agenticx.avatar.registry`；`server.py` 已在启动时加载二者，但必须用冷启动 smoke 验证无循环导入（NFR-2）。

### 5.3 web-portal：`src/lib/desktop-agent-publish.ts`（新建）

```ts
import {
  AgentSlugConflictError, AgentVersionConflictError, createAgentVersion, createAgentWithInitialVersion,
  getAgentVersion, getAgentWithMa, listAgentsWithMa, previewAgentManifest, updateAgentMaSettings,
  type EnterpriseAgentWithMa,
} from "@agenticx/iam-core";

export type PublishInput = {
  tenantId: string; userId: string; localAvatarId: string; displayName: string;
  description: string | null; manifest: Record<string, unknown>; note: string | null;
};
export type PublishResult =
  | { kind: "ok"; status: 200 | 201; body: { agent_id: string; version: number; created: boolean;
      lifecycle: "draft" | "published" | "recalled"; routing_mode: "follow_latest" | "pinned"; effective_version: number } }
  | { kind: "invalid"; errors: string[] }
  | { kind: "recalled" }
  | { kind: "conflict" };

export function employeePublishSlug(localAvatarId: string, suffix?: string): string;
export async function publishEmployeeAgentVersion(input: PublishInput): Promise<PublishResult>;
```

`employeePublishSlug`：与 iam-core `employeeSlug` 相同算法（`"e" + localAvatarId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)`，长度 <2 回落 `"employee-agent"`），有 `suffix` 时为 `${base.slice(0, 56)}-${suffix}`（`suffix` 为 6 位小写 base36 随机）。

**`publishEmployeeAgentVersion` 算法**：

```text
agents = await listAgentsWithMa(tenantId)
existing = agents.find(a => a.origin === "employee" && a.ownerUserId === userId && a.localAvatarId === localAvatarId)
if (!existing):
    input = { slug: employeePublishSlug(localAvatarId), displayName, description, model: "", systemPrompt: "",
              runtime: "desktop_worker", assignmentKeys: [userId], workerKeys: [userId],
              lifecycle: "draft", origin: "employee", ownerUserId: userId, localAvatarId }
    try { created = await createAgentWithInitialVersion(tenantId, input, { manifest, note, createdBy: userId, source: "desktop" }) }
    catch (e) {
      if (e.name === "AgentManifestInvalidError") return { kind: "invalid", errors: e.errors ?? [] }
      if (e.name === "AgentSlugConflictError") retry once with employeePublishSlug(localAvatarId, random6)
      else throw e
    }
    return ok 201 { agent_id: created.agent.id, version: created.version.version, created: true,
                    lifecycle: created.agent.lifecycle, routing_mode: created.agent.versionRouting,
                    effective_version: created.agent.effectiveVersion }
if (existing.lifecycle === "recalled") return { kind: "recalled" }
preview = await previewAgentManifest(tenantId, manifest)
if (!preview.ok) return { kind: "invalid", errors: preview.errors }
latest = await getAgentVersion(tenantId, existing.id, existing.latestVersion)
if (latest.manifestHash === preview.manifestHash)
    return ok 200 { agent_id: existing.id, version: latest.version, created: false, lifecycle: existing.lifecycle,
                    routing_mode: existing.versionRouting, effective_version: existing.effectiveVersion }
if (existing.lifecycle === "published" && existing.versionRouting === "follow_latest")
    await updateAgentMaSettings(tenantId, existing.id, { versionRouting: "pinned", pinnedVersion: existing.effectiveVersion })
let expected = existing.latestVersion
for attempt in [1, 2]:
    try { r = await createAgentVersion(tenantId, existing.id, { manifest, expectedLatestVersion: expected, note, createdBy: userId, source: "desktop" }); break }
    catch (e) {
      if (e.name === "AgentManifestInvalidError") return { kind: "invalid", errors: e.errors ?? [] }
      if (e.name === "AgentVersionConflictError" && attempt === 1) { expected = (await getAgentWithMa(tenantId, existing.id)).latestVersion; continue }
      if (e.name === "AgentVersionConflictError") return { kind: "conflict" }
      throw e
    }
fresh = await getAgentWithMa(tenantId, existing.id)
return ok (r.created ? 201 : 200) { agent_id: existing.id, version: r.version.version, created: r.created,
           lifecycle: fresh.lifecycle, routing_mode: fresh.versionRouting, effective_version: fresh.effectiveVersion }
```

错误按 `error.name` 判断（跨包 `instanceof` 不可靠，与 E02 约定一致）。`AgentManifestInvalidError` 的错误数组字段名以 iam-core 实际定义为准（`rg -n "class AgentManifestInvalidError" -A6 enterprise/packages/iam-core/src`）。

### 5.4 web-portal：`src/app/api/desktop/agents/publish/route.ts`（新建）

```ts
export const dynamic = "force-dynamic";
const LOCAL_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOWED = ["local_avatar_id", "display_name", "description", "manifest", "note"] as const;

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const body = await readJsonObject(request);           // from lib/worker-tasks/protocol
    const unknown = Object.keys(body).filter((k) => !(ALLOWED as readonly string[]).includes(k)).sort()[0];
    if (unknown) throw new WorkerRequestError(`未知字段：${unknown}`);
    // validate per §4.1, throwing WorkerRequestError with Chinese messages
    const result = await publishEmployeeAgentVersion({ tenantId: identity.tenantId, userId: identity.userId, ... });
    switch (result.kind) {
      case "ok": return NextResponse.json(result.body, { status: result.status });
      case "invalid": return NextResponse.json({ code: "40001", message: "manifest is invalid", errors: result.errors }, { status: 400 });
      case "recalled": return NextResponse.json({ code: "40900", message: "该智能体已被管理员回收，无法再次提交" }, { status: 409 });
      case "conflict": return NextResponse.json({ code: "40901", message: "企业侧版本刚被更新，请稍后重试" }, { status: 409 });
      default: { const exhaustive: never = result; return exhaustive; }
    }
  } catch (error) {
    if (error instanceof WorkerRequestError) return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    if (error instanceof Error && error.name === "AgentValidationError")
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    return workerErrorResponse(error);
  }
}
```

（`switch` 的 `never` 穷尽检查遵循仓库 TS 规则。`WorkerRequestError`、`readJsonObject`、`workerErrorResponse`、`workerUnauthorized` 均来自 `src/lib/worker-tasks/protocol`，`register/route.ts:4` 已有同样的导入。）

### 5.5 Desktop：`AvatarEnterprisePublishTab.tsx`（新建）

```tsx
type Props = { avatarId: string; avatarName: string };
export function AvatarEnterprisePublishTab({ avatarId, avatarName }: Props): JSX.Element;
```

- 挂载即 `studioFetch(\`/api/avatars/${encodeURIComponent(avatarId)}/enterprise-publish\`, { method: "POST", apiToken, headers: {"Content-Type": "application/json"}, body: JSON.stringify({ dry_run: true }) })`（`apiToken` 来自 `useAppStore((s) => s.apiToken)`）。
- 409 → 「请先在 设置 → 账号 登录企业账号」；404 → 「分身不存在」；`ok:false` → 红色错误框列出 `report.errors`（不提供提交按钮）。
- 预览内容（只读）：
  1. 提示条：`avatar.enterprisePublish.savedHint`「提交的是已保存的分身配置；如有未保存的修改，请先在其它 tab 保存」。
  2. 模型：`report.model`。
  3. 工具与权限表：`included_tools`（策略显示「自动执行」/「每次询问」）、`disabled_tools`（「已禁用」）、`excluded_tools`（「未纳入：托管模式不支持该工具」）。
  4. 安全处理：`removed_credential_refs`（「已移除凭证引用：A、B」）、`redacted_secrets > 0`（「已隐去 N 处疑似密钥」）、`replaced_local_paths > 0`（「已把 N 处本机路径替换为 ~」）；三项都为空显示「未发现需要隐去的内容」。
  5. 说明：`warnings` 逐条（灰色小字）。
  6. 版本说明输入框（`textarea`，最多 500 字，placeholder「选填：这次改了什么」）。
  7. 唯一主按钮「提交到企业」（`--ui-btn-primary-*` 主题变量；提交中禁用并显示 spinner）。**不出现「保存」按钮**。
- 提交：同一路由 `dry_run:false` + `note`。结果文案（就近显示在按钮上方，绿色成功 / 黄色提示 / 红色失败；失败**保留面板与输入**并透出 `message`，例如「HTTP 409 · 该智能体已被管理员回收，无法再次提交」）：
  - `created && lifecycle === "draft"` → 「已提交为草稿 v{{version}}，管理员发布后员工可见」
  - `created && routing_mode === "pinned"` → 「已提交新版本 v{{version}}，当前生效仍是 v{{effective}}，管理员切换后生效」
  - `created`（其它） → 「已提交新版本 v{{version}}」
  - `!created` → 「内容与企业侧最新版本 v{{version}} 一致，无需重复提交」
- 主题 token：卡片 `rounded-lg border border-border bg-surface-card`；不得硬编码颜色。

### 5.6 `AvatarSettingsPanel.tsx`

1. `type Tab`（:77）追加 `| "enterprise"`。
2. 新状态 `const [enterpriseLoggedIn, setEnterpriseLoggedIn] = useState(false);` + effect：`window.agenticxDesktop.loadEnterpriseAccount()` 与 `onEnterpriseAccountChanged`（写法同 `AccountTab.tsx:109-152`）。
3. tabs（:385–395）分身模式数组末尾按条件追加 `...(enterpriseLoggedIn ? [{ id: "enterprise" as Tab, label: st("avatar.tabEnterprise") }] : [])`。
4. 内容区（:439 之后，与其它 `activeTab === ...` 分支并列）：`{activeTab === "enterprise" && mode === "avatar" && avatar && <AvatarEnterprisePublishTab avatarId={avatar.id} avatarName={avatar.name} />}`。
5. 其它 tab 的保存逻辑、底部按钮、关闭行为不变。

### 5.7 文案（`desktop/locales/zh/settings.json` 的 `avatar` 节；en 同步）

| 键 | 中文 |
|---|---|
| `avatar.tabEnterprise` | 企业 |
| `avatar.enterprisePublish.title` | 发布到企业 |
| `avatar.enterprisePublish.intro` | 把这个分身作为企业智能体的草稿版本提交，管理员审核发布后，被分配的同事可以使用。 |
| `avatar.enterprisePublish.savedHint` | 提交的是已保存的分身配置；如有未保存的修改，请先在其它 tab 保存 |
| `avatar.enterprisePublish.model` | 模型 |
| `avatar.enterprisePublish.tools` | 工具与权限 |
| `avatar.enterprisePublish.policy.always_allow` / `policy.always_ask` / `disabled` / `excluded` | 自动执行 / 每次询问 / 已禁用 / 未纳入 |
| `avatar.enterprisePublish.security` | 安全处理 |
| `avatar.enterprisePublish.removedRefs` | 已移除凭证引用：{{names}} |
| `avatar.enterprisePublish.redacted` | 已隐去 {{count}} 处疑似密钥 |
| `avatar.enterprisePublish.paths` | 已把 {{count}} 处本机路径替换为 ~ |
| `avatar.enterprisePublish.clean` | 未发现需要隐去的内容 |
| `avatar.enterprisePublish.notes` | 说明 |
| `avatar.enterprisePublish.notePlaceholder` | 选填：这次改了什么 |
| `avatar.enterprisePublish.submit` | 提交到企业 |
| `avatar.enterprisePublish.result.draft` / `result.pinned` / `result.created` / `result.unchanged` | 见 §5.5 四条 |
| `avatar.enterprisePublish.err.login` / `err.notFound` / `err.load` | 请先在 设置 → 账号 登录企业账号 / 分身不存在 / 加载预览失败：{{message}} |

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 员工想把分身交给企业 | 只有保存时的隐式三列同步（新建即发布） | 显式「提交到企业」：完整 Manifest、预览、草稿 / 候选版本 |
| 已发布员工 Agent 再提交 | — | 路由固定在当前生效版本，新版本待管理员切换 |
| 重复提交同一内容 | — | 不新建版本 |
| 系统提示里的 `${cred:X}` / 密钥 / 家目录路径 | 隐式同步原样上传 | 发布路径上清洗并在预览中告知（隐式同步路径不变，见 §12 Q3） |

---

## 7. FR / NFR / AC

| ID | 需求 | AC（文件 :: 用例 → 断言） |
|---|---|---|
| FR-P1 | 清洗 | `tests/test_enterprise_agent_publish.py::test_sanitize_system_prompt`（`monkeypatch.setenv("HOME", tmp)` 隔离本机凭证库，使 `redact_text` 无已存密钥）：输入含 `${cred:GITHUB_TOKEN}`、`agx-pat-abc123def`、`sk-ABCDEFGHIJKLMNOPQRS`、`Bearer abcdefghijklmnop`、`/Users/alice/work/a.md`、`C:\Users\bob\x` → 输出不含任何原值；`refs == ["GITHUB_TOKEN"]`；`secrets == 3`；`paths == 2`；含 `[凭证引用已移除:GITHUB_TOKEN]` 与 `~/work/a.md` |
| FR-P2 | 本机已存密钥 | `test_sanitize_uses_redact_text`：`monkeypatch` `redact_text` 为把 `s3cr3t` 换成 `[REDACTED:X]` 的替身 → 输出不含 `s3cr3t`，`secrets` 计入 1 |
| FR-P3 | 模型映射 | `test_resolve_manifest_model`：`("deepseek","deepseek-chat")` → `deepseek/deepseek-chat`；`("enterprise","openai/gpt-4o")` → `openai/gpt-4o`；`("", "x")` → None；`("p", "")` → None |
| FR-P4 | 工具映射 | `test_tool_mapping`：分身 `tools_enabled={"web_search": False, "knowledge_search": True}`，全局 `{"liteparse": False}` → `disabled_tools == ["web_search","liteparse"]`（按白名单顺序）；`bash_exec`、`file_write`、`file_edit` 的 config 为 `always_ask`；`excluded_tools == [{"name":"knowledge_search",...}]`；Manifest 经 `validate_manifest` 通过且 `compile_spec("draft",1,m)` 编译出的工具名集合 = 白名单 − 禁用项 |
| FR-P5 | 缺模型与超长 | `test_build_reports_errors`：无默认模型 → `report.errors[0] == ERR_NO_MODEL`；系统提示 70 000 字节 → 错误含「64 KiB」 |
| FR-P6 | Manifest 无密钥结构 | `test_manifest_has_no_secret_fields`：输出 `mcp_servers == []`、`skills == []`、`tools` 只有一个 `agx_builtin` 项、`metadata` 只有 `welcome_message` 与 `suggested_questions`；`json.dumps(manifest)` 不含分身 `workspace_dir` 的值 |
| FR-P7 | 提交请求 | `test_publish_avatar_draft_posts_expected_body`：`http_post` 替身记录参数 → URL `https://portal.example/api/desktop/agents/publish`、`Authorization: Bearer agx-pat-x`、`trust_env is False`、body 键集合 `{local_avatar_id, display_name, description, manifest}`（无 note 时不含 note）；替身返回 409 `{"message":"该智能体已被管理员回收，无法再次提交"}` → `EnterprisePublishError.status == 409` 且 message 相同；`httpx.ConnectError` → status 0 |
| FR-R1 | 本机路由 | `tests/test_enterprise_agent_publish_route.py`（FastAPI app + `register_enterprise_worker_routes(app, check_token=lambda _t: None)`，`HOME` 指向 tmp 并用 `AvatarRegistry` 建分身）：`test_dry_run_returns_preview`（`ok`、`dry_run`、`report.model`）；`test_not_logged_in_409`；`test_unknown_avatar_404`；`test_manifest_invalid_returns_ok_false`（无模型 → `ok:false`、`error == "manifest_invalid"`，且 `publish_avatar_draft` 未被调用）；`test_publish_success_and_failure`（`monkeypatch` `publish_avatar_draft`：成功 → `result` 原样；抛 `EnterprisePublishError(409,"x")` → `ok:false`、`message == "HTTP 409 · x"`） |
| FR-W1 | 新建草稿 | `web-portal/src/lib/desktop-agent-publish.test.ts`（vi.mock `@agenticx/iam-core`）：`creates a draft employee agent on first publish`（`createAgentWithInitialVersion` 第二参含 `lifecycle:"draft"`、`origin:"employee"`、`runtime:"desktop_worker"`、`ownerUserId`、`localAvatarId`、`assignmentKeys:[userId]`、`workerKeys:[userId]`；第三参 `source:"desktop"`、`createdBy:userId`；结果 201、`version 1`） |
| FR-W2 | 幂等 | `returns created false when manifest hash matches latest`（`previewAgentManifest` 与 `getAgentVersion` 哈希相同 → 200、`created:false`；`createAgentVersion` 与 `updateAgentMaSettings` 均未调用） |
| FR-W3 | 已发布跟随最新 → 先固定 | `pins routing before adding a version to a published follow_latest agent`：existing `{lifecycle:"published", versionRouting:"follow_latest", effectiveVersion:3, latestVersion:3}` → `updateAgentMaSettings` 以 `{versionRouting:"pinned", pinnedVersion:3}` 调用，且调用顺序先于 `createAgentVersion`（`mock.invocationCallOrder`）；草稿 Agent 不固定 |
| FR-W4 | 回收与冲突 | `rejects recalled agents`（→ `kind:"recalled"`，无写调用）；`retries once on version conflict`（第一次抛 `{name:"AgentVersionConflictError"}`，第二次成功 → `createAgentVersion` 调用 2 次，第二次 `expectedLatestVersion` 取自 `getAgentWithMa`）；连续两次冲突 → `kind:"conflict"` |
| FR-W5 | slug 冲突 | `retries slug once on conflict`：第一次 `createAgentWithInitialVersion` 抛 `{name:"AgentSlugConflictError"}` → 第二次 slug 匹配 `/^e[a-z0-9]{1,40}-[a-z0-9]{6}$/` |
| FR-W6 | 路由校验 | `web-portal/src/app/api/desktop/agents/publish/__tests__/route.test.ts`（vi.mock `desktop-auth` 与 `../../../../../lib/desktop-agent-publish`）：`401 without identity`；`400 on unknown field`；`400 on bad local_avatar_id`；`maps invalid to 400 with errors`；`maps recalled to 409 40900` |
| FR-D1 | 预览与提交 UI | `desktop/src/components/AvatarEnterprisePublishTab.test.tsx`（mock `studioFetch`）：`loads dry-run preview on mount`（显示模型、「每次询问」、「已移除凭证引用：GITHUB_TOKEN」）；`hides submit when report has errors`；`submits with note and shows draft result`（body `{"dry_run":false,"note":"x"}`；显示「已提交为草稿 v1」）；`keeps panel and shows backend error on failure`（`ok:false, message:"HTTP 409 · …"` → 文案可见、备注输入仍保留）；`shows unchanged message`；`only one primary button` |
| FR-D2 | tab 可见性 | 同文件 `AvatarSettingsPanel shows enterprise tab only when logged in`：mock `loadEnterpriseAccount` 返回 `loggedIn:false` → 无「企业」tab；`true` → 有 |
| NFR-1 | `agx serve` 冷启动 smoke | `enterprise_worker_routes.py` 被 `server.py` 顶层导入 → 见 §8 |
| NFR-2 | 导入无环 | `python -c "import agenticx.studio.server; import agenticx.runtime.enterprise_agent_publish; print('ok')"` |
| NFR-3 | 既有行为不变 | `pytest tests/test_enterprise_worker_routes.py -q --no-cov` 全绿；`git diff --quiet -- agenticx/studio/server.py agenticx/avatar/registry.py agenticx/runtime/enterprise_agent_sync.py enterprise/apps/web-portal/src/app/api/desktop/agents/register` |
| NFR-4 | 文案对齐 | `npm -C desktop test -- src/i18n/message-parity.test.ts` |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/test_enterprise_agent_publish.py tests/test_enterprise_agent_publish_route.py tests/test_enterprise_worker_routes.py -q --no-cov
python -c "import agenticx.studio.server; import agenticx.runtime.enterprise_agent_publish; print('imports ok')"
git diff --quiet -- agenticx/studio/server.py && echo "server.py untouched"
pnpm -C enterprise --filter @agenticx/app-web-portal test -- src/lib/desktop-agent-publish.test.ts src/app/api/desktop/agents
pnpm -C enterprise --filter @agenticx/app-web-portal typecheck
npm -C desktop test -- src/components/AvatarEnterprisePublishTab.test.tsx src/i18n/message-parity.test.ts
npm -C desktop test
npm -C desktop run build
```

**`agx serve` 冷启动 smoke**：同 MA-D01 §8 脚本，请求路径列表为 `/api/session /api/avatars /api/sessions`，期望三行 200；另加一条 `curl -X POST .../api/avatars/<任一已存在分身 id>/enterprise-publish -d '{"dry_run":true}'`：未登录企业时期望 409。

Python 改动需 ⌘Q 完全退出 Near 或重启 `npm run dev`（内置 `agx serve` 重新加载）。本文不改 `desktop/electron/**`。

**演示**：
1. Near 登录企业；打开一个分身设置 → 「企业」tab：看到模型、工具策略、安全处理摘要。
2. 写备注「第一次提交」→ 提交 → 「已提交为草稿 v1」（若该分身此前被自动登记过，则显示「已提交新版本 vN，当前生效仍是 vM」）。
3. 不改任何内容再提交 → 「内容与企业侧最新版本一致」。
4. admin-console `/admin/agents`：该员工 Agent 版本列表出现来源「桌面」的版本；在版本页切换生效版本 / 发布。
5. 退出企业登录后再打开分身设置：无「企业」tab，其它 tab 行为不变。

---

## 9. 回滚

- 无运行时开关：未登录企业时入口不显示，路由返回 409；门户新路由无人调用即无影响。
- 代码回滚：删除 §3.1 新建文件，`git checkout` 修改文件。已写入企业库的草稿 Agent / 版本保留（管理员可停用或删除）；已被固定的路由需管理员在版本页手动改回「跟随最新」（回滚说明里写明）。

---

## 10. 不变量

1. 未登录企业：分身设置面板 tab 与现状完全一致。
2. 保存分身时的自动登记（`sync_local_avatar` → `/register`）请求与响应不变。
3. `/api/desktop/agents/register`、`registerEmployeeAgent` 不变。
4. Manifest 中不出现 `${cred:…}` 原文、本机密钥明文、家目录绝对路径、MCP URL 与凭证。
5. `agenticx/studio/server.py` 零改动；面板内只有一个主操作按钮。

---

## 11. 风险

1. **自动登记与发布交织**：保存分身仍会触发 `/register` → `updateAgent` 改三列；按 E01 D4，已有版本行的 Agent 会因此追加一个 `legacy_edit` 版本，成为「最新版本」（不影响已固定的生效版本，但管理员看到的最新版本可能是派生版而不是员工提交的版本）。见 §12 Q3。
2. **模型名不匹配**：本机 provider 名在企业网关不存在时，草稿可保存（企业侧只校验格式），但会话运行会失败；预览已提示，管理员发布前需调整。
3. **工具默认策略**：写类工具默认「每次询问」，无人值守场景（定时 / 渠道）会停在 `requires_action`；管理员需在 E02 编辑器显式放宽。
4. `previewAgentManifest` 若会固化 skill 版本或访问租户技能表，草稿 `skills: []` 时无额外开销。

---

## 12. 待确认问题

- **Q1（栈规则）**：门户新路由（TS）超出 master §0 规则 1。可选：与 MA-D02 的门户改动合并成独立的「桌面 BFF 扩展」子规划先行合入。
- **Q2（技能）**：首版不打包上传本机技能（D3）。是否需要单独立项「员工技能提交到企业技能库（含安全扫描与管理员审核）」？
- **Q3（自动登记）**：是否在后续子规划中把「保存分身即自动登记并发布」改为「只登记、不发布」或在员工使用过「提交到企业」后停止自动同步三列？这会改变现有门户行为，本文不做。
- **Q4（偏离 master 落点）**：master §9 写「复用 `/register` 并扩展字段」，本文新增 `/publish`（D1 给出理由）。是否接受并在 master §12 登记？
