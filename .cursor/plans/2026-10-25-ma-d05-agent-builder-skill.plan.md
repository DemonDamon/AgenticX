# MA-D05 Near 内置技能「企业智能体构建」：对话中创建 / 修改企业智能体草稿、展示版本差异、绝不发布

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W6，编号 MA-D05）
Depends-on: MA-D04（已实施：`agenticx/runtime/enterprise_agent_publish.py`、web-portal `POST /api/desktop/agents/publish`）、MA-E02（已实施，版本与路由）、MA-00 / MA-A01（已实施，Manifest 校验与 `compile_spec`）。**不依赖** MA-E11（见 §2 D1，须登记 master §12）
栈：Python（Near 本机后端工具 + 内置技能 Markdown）+ TS（web-portal 两个只读路由）

> 风险等级：低。写入只经 MA-D04 已有的发布接口（服务端保证「草稿 / 不改变当前生效版本」）；本子规划新增的企业端路由全部只读。新工具默认延迟加载，只有技能激活时模型才会用到；未登录企业时工具直接返回提示。

---

## 0. 一句话目标

在 Near 里新增内置技能 `agenticx-enterprise-agent-builder` 与一个延迟加载的工具 `enterprise_agent_builder`（动作 `list` / `get` / `preview` / `submit`）：员工用自然语言描述需求，模型据技能指引起草 `agx.agent/v1` Manifest，先本机校验并展示与企业侧最新版本的**差异**，员工确认后以**草稿版本**提交到企业（新建的企业智能体为 `draft`；已发布的智能体先固定在当前生效版本再追加版本）；**任何情况下都不发布**，发布由管理员在管理台完成。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 位置 | 内容 | 本文落点 |
|---|---|---|
| §3.3 缺口表「自然语言构建 Agent」 | 智谱有；框架有 `skill_manage`；企业 / 桌面无 | 本文 |
| §9 MA-D05 行 | 「内置 skill：在 Near 对话中经 `ma:` API 创建 / 修改 Agent 草稿并展示版本差异；发布仍需管理员确认」；依赖 MA-E11 | §2 D1 改为经 MA-D04 的桌面发布通道（设备令牌），不经 `ma:` PAT |
| §4 决策 8 | Manifest 严格校验、不得含密钥、MCP 不得带 headers / env | 本机 `preview` 先跑同一校验器；技能明确禁止写密钥 |
| §4 决策 9 | 个人模式不变 | 新工具只在显式调用时生效；未登录企业直接返回提示；不改任何既有工具 |
| §12「分身保存时自动登记仍产生 `legacy_edit` 版本」 | 已知限制 | 本文只修改员工自己通过本工具 / D04 提交的智能体，不触碰自动登记路径 |
| §12 托管内置工具白名单 14 个 | Manifest 只能用这 14 个内置工具 | 技能把白名单逐字列出 |

### 1.2 调研语义（`research/managed-agents/zhipu/builder-skill.md`）

- L10–18：在本地助手里用自然语言新建 / 修改云端 Agent，给出配置方案并调用 API。
- L37–39：密钥不要写进任务描述。
- L43–48：交付可复用的 Agent ID、配置与差异说明；「给已有 Agent 增加能力时，会保留未修改的数组项；更新只影响新版本引用」。
- 与我们的差异：它直接调用公开 API 并可立即生效；我们要求**只产出草稿**，生效由管理员决定（企业治理）。

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 现状 | 结论 |
|---|---|---|---|
| `agenticx/runtime/enterprise_agent_publish.py` | 196–212、231–275 | `enterprise_publish_settings() -> (token, base_url) | None`（要求 `enterprise.enabled is True`）；`publish_avatar_draft(avatar, manifest, note, *, settings, http_post)` → `POST {base}/api/desktop/agents/publish`，`trust_env=False`，错误映射为 `EnterprisePublishError(status, message, errors)` | 复用设置读取与错误类型；新写一个不依赖 `AvatarConfig` 的提交函数 |
| `enterprise/apps/web-portal/src/app/api/desktop/agents/publish/route.ts` | 14–15、56–104 | 请求体 `local_avatar_id`（`^[A-Za-z0-9._-]{1,128}$`）、`display_name`（1–64）、`description`（≤500）、`manifest`、`note`（≤500）；未知字段 400 | 新智能体用合成的 `local_avatar_id`（§2 D3） |
| `enterprise/apps/web-portal/src/lib/desktop-agent-publish.ts` | 126–233 | 幂等键 `(tenant, ownerUserId, localAvatarId, origin="employee")`；不存在 → 新建 `lifecycle:"draft"`、`runtime:"desktop_worker"`、仅分配给本人；存在且 `recalled` → 409；内容 hash 相同 → 200 `created:false`；已发布且跟随最新 → 先固定当前生效版本再追加 | 「绝不发布」由服务端保证 |
| `enterprise/apps/web-portal/src/app/api/desktop/agents/route.ts` | 6–27 | 只列「已分配给我」的已发布智能体，不含 Manifest 与版本 | 需要新的只读路由列出「我提交的智能体」及其版本 |
| `enterprise/packages/iam-core/src/repos/agents.ts` / `agent-versions.ts` | 467–475；158–179 | `listAgentsWithMa`、`getAgentWithMa`、`getAgentVersion`、`listAgentVersions(tenant, agent, {limit})` | 只读路由直接复用 |
| `enterprise/apps/web-portal/src/lib/desktop-auth.ts` | 26–38 | `resolveDesktopIdentity`：设备 PAT（`agx-pat-`）→ `{tenantId, userId, ...}` | 新路由同一鉴权 |
| `agenticx/managed/manifest.py` / `spec.py` | `validate_manifest`；`compile_spec`、`MANAGED_BUILTIN_TOOLS`（14 个） | 本机预检与企业保存同口径（企业侧另做 tenant skill 固化） | `preview` 用两者 |
| `agenticx/cli/agent_tools.py` | 802（`STUDIO_TOOLS`）、1800–1830（`skill_manage` schema 写法）、13076–13077（`skill_manage` 分发写法）、4354–4361（`_confirm(question, *, confirm_gate, context, emit_event, session)`） | 工具注册与确认门 | 新增一个 schema、一个分发分支、一个工具函数 |
| `agenticx/runtime/tool_search.py` | 73–131 | `BUILTIN_DEFER_ALLOWLIST`：列入者默认延迟加载 | 新工具加入，避免给每个个人会话增加工具表噪声 |
| `agenticx/tools/skill_bundle.py` | 160、239–253 | 内置技能根 = `agenticx/skills/`，其下技能目录来源标记为 `builtin` | 新技能放 `agenticx/skills/agenticx-enterprise-agent-builder/SKILL.md` |
| `agenticx/skills/agenticx-agent-builder/SKILL.md` | 1–30 | 已有「本机数字分身构建」技能（create_avatar） | 两者用途不同：新技能 description 明确「企业智能体草稿」，并在正文提示与本机分身的区别 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **凭证 = Near 已登录企业的设备令牌**（`enterprise.token`，经 `enterprise_publish_settings()`），写入走 MA-D04 的 `POST /api/desktop/agents/publish`；**不**让员工在设置里粘贴 `ma:agents:write` PAT，也不经 `/ma/v1/agents` | 持有 `ma:agents:write` 的 PAT 可以直接创建版本与改路由（跟随最新时新版本立即生效），「只出草稿」只能靠客户端自觉；D04 发布接口在服务端强制「新建即 draft、已发布先固定生效版本」，治理边界在服务端。因此不依赖 MA-E11 SDK |
| D2 | **可修改范围 = 员工本人提交的企业智能体**（`origin="employee"` 且 `ownerUserId` 为本人，未回收）；管理员创建的智能体只读不可改 | 与 D04 幂等键一致；改他人或企业智能体需要管理员权限，列入后续 |
| D3 | 新建时合成 `local_avatar_id`：`slug` = 小写后把非 `[a-z0-9]` 连续段替换为 `-`、去首尾 `-`；`slug` 非空 → `"nl-" + slug[:40]`；为空（如纯中文名）→ `"nl-" + sha256(display_name.strip().encode("utf-8")).hexdigest()[:16]`。同名再次提交 = 更新同一个企业智能体（幂等），不同中文名不会撞到同一个标识 | 复用 D04 幂等语义；避免重复点击产生多个智能体 |
| D4 | **一个工具、四个动作**：`list`（我的智能体）、`get`（某版本 Manifest）、`preview`（本机校验 + 差异，不写）、`submit`（经确认后提交草稿）；工具加入延迟加载名单 | 单个 schema 体积小；不污染个人会话工具表 |
| D5 | `submit` **强制**经 `_confirm` 确认门（问题文本含差异摘要）；`Run Everything` 等全局放行策略照常生效（与其他写操作一致，不另弹窗） | 用户明确确认才写企业；遵守既有确认策略，不重复询问 |
| D6 | 差异 = 结构化摘要（模型、系统提示行数增减、内置工具启用 / 停用 / 策略变化、MCP 服务、技能、运行上限、元数据键）+ 规范化 JSON 的 unified diff（截断 12000 字符）；以纯文本 / Markdown 返回给模型，由模型在对话中展示（代码块 `diff`） | Near 无需新增 UI；ToolCallCard 已能展示工具结果 |
| D7 | `preview` / `submit` 前本机拒绝：Manifest 校验失败、`compile_spec` 语义失败、出现疑似密钥（`agenticx.runtime.credential_store.redact_text` 改变了文本或匹配 `${cred:` 引用）、系统提示里出现本机绝对路径（复用 D04 的 `HOME_PATH_RE`） | 与 D04 发布预检同口径（master §4 决策 8） |
| D8 | 新建的企业智能体沿用 D04 默认：`runtime="desktop_worker"`、仅分配给本人；技能文案说明「管理员发布时可改为云端运行并分配给他人」 | 不改 D04 服务端行为 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

Python（Near 本机后端）：
- 新建 `agenticx/runtime/enterprise_agent_builder.py`
- 修改 `agenticx/cli/agent_tools.py`：`STUDIO_TOOLS` 追加一个 schema（放在 `skill_manage` schema 之后）；`_dispatch_tool_async_unredacted` 在 `if name == "skill_manage":`（当前 L13076）**之前**插入两行分发；文件末尾区域新增 `async def _tool_enterprise_agent_builder(...)`（与其它 `_tool_*` 函数并列）。不改任何其它行。
- 修改 `agenticx/runtime/tool_search.py`：`BUILTIN_DEFER_ALLOWLIST` 追加 `"enterprise_agent_builder"`（按字母序插入在 `"create_avatar"` 之后、`"update_self_identity"` 之前的位置不要求，只要在集合字面量内）
- 新建 `agenticx/skills/agenticx-enterprise-agent-builder/SKILL.md`
- 新建 `tests/test_enterprise_agent_builder.py`、`tests/test_enterprise_agent_builder_tool.py`

TS（web-portal，只读）：
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/drafts/route.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/drafts/[agentId]/route.ts`
- 新建 `enterprise/apps/web-portal/src/app/api/desktop/agents/drafts/__tests__/route.test.ts`

### 3.2 Out of scope

- 不改 `POST /api/desktop/agents/publish` 与 `desktop-agent-publish.ts`（D04 已实现的服务端语义即本文的安全边界）。
- 不改 Desktop 前端（`desktop/`），不新增设置项、不新增 PAT 输入框。
- 不修改管理员创建的智能体；不提供发布 / 回收 / 路由切换能力。
- 不上传本机技能包、不配置 MCP 凭证（Manifest 内本就不允许）；Vault 绑定由管理员在管理台完成。
- 不在托管会话（`agenticx/managed`）里暴露本工具（它不在托管白名单内，保持如此）。
- 不改已有技能 `agenticx-agent-builder`。

---

## 4. 精确落点

### 4.1 新建 `agenticx/runtime/enterprise_agent_builder.py`

文件头：`#!/usr/bin/env python3` + 英文 docstring + `Author: Damon Li`；`from __future__ import annotations`；绝对 import，置顶。

```python
import copy
import difflib
import json
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Mapping

import httpx

from agenticx.managed.errors import MAError
from agenticx.managed.manifest import canonical_json, validate_manifest
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec
from agenticx.runtime.credential_store import CRED_REF_RE, redact_text
from agenticx.runtime.enterprise_agent_publish import (
    HOME_PATH_RE,
    EnterprisePublishError,
    enterprise_publish_settings,
)

LOCAL_ID_PREFIX = "nl-"
MAX_DIFF_CHARS = 12000
MAX_DISPLAY_NAME = 64
MAX_DESCRIPTION = 500
MAX_NOTE = 500
NOT_LOGGED_IN_TEXT = "ERROR: 尚未登录企业账号。请先在 Near「设置 → 企业」中登录后再试。"


@dataclass
class DraftSummary:
    agent_id: str
    display_name: str
    description: str | None
    local_avatar_id: str
    lifecycle: str                 # draft | published | recalled
    latest_version: int
    effective_version: int
    routing_mode: str              # follow_latest | pinned
    updated_at: str


@dataclass
class PreviewReport:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    normalized: dict[str, Any] | None = None
    manifest_hash: str | None = None
    base_version: int | None = None
    summary: list[str] = field(default_factory=list)
    diff: str = ""


def synth_local_id(display_name: str) -> str: ...
def list_my_agents(*, settings: tuple[str, str], http_get: Any = httpx.get) -> list[DraftSummary]: ...
def get_my_agent(agent_id: str, version: int | None, *, settings: tuple[str, str],
                 http_get: Any = httpx.get) -> dict[str, Any]: ...
def preview_manifest(manifest: Any, *, base_manifest: Mapping[str, Any] | None,
                     base_version: int | None) -> PreviewReport: ...
def summarize_diff(base: Mapping[str, Any] | None, new: Mapping[str, Any]) -> list[str]: ...
def unified_manifest_diff(base: Mapping[str, Any] | None, new: Mapping[str, Any]) -> str: ...
def submit_draft(*, manifest: Mapping[str, Any], display_name: str, description: str | None,
                 note: str | None, local_avatar_id: str, settings: tuple[str, str],
                 http_post: Any = httpx.post) -> dict[str, Any]: ...
def render_preview(report: PreviewReport) -> str: ...
```

实现规则：
- `synth_local_id`：见 §2 D3；结果必须匹配 `^[A-Za-z0-9._-]{1,128}$`。
- `list_my_agents`：`GET {base}/api/desktop/agents/drafts`，头 `Authorization: Bearer <token>`，`timeout=15.0`、`trust_env=False`；非 2xx → `EnterprisePublishError(status, message)`（message 取响应 `message` 或 `HTTP <status>`）；网络错误 → `EnterprisePublishError(0, "无法连接企业服务")`。返回体形状见 §6.2。
- `get_my_agent`：`GET {base}/api/desktop/agents/drafts/{agent_id}` 可带 `?version=<n>`；同上错误映射。
- `preview_manifest`（不发网络请求）：
  1. `result = validate_manifest(manifest)`；不 ok → `errors = result.errors`，直接返回。
  2. `compile_spec("draft", 1, result.normalized)`；`MAError` → `errors = details["errors"]` 或 `[str(exc)]`。
  3. 密钥与路径：把 `normalized` 的 `canonical_json` 文本记为 `t`；`redact_text(t) != t` → 错误 `检测到疑似密钥，请删除后再试（密钥由管理员在凭证库中配置）`；`CRED_REF_RE.search(t)` → 错误 `不能使用本机凭证引用 ${cred:...}`；`HOME_PATH_RE.search(normalized["system"])` → 错误 `系统提示中包含本机路径，请改为相对说明`。
  4. 提示（不阻断）：`normalized["skills"]` 非空 → `技能需管理员在企业技能库中上架；未上架的技能会导致保存失败`；`normalized["mcp_servers"]` 非空 → `MCP 服务的访问凭证由管理员在凭证库中配置`；Manifest 里没有任何 `agx_builtin` 工具集 → `未启用任何内置工具，智能体只能对话`。
  5. `summary = summarize_diff(base_manifest, normalized)`；`diff = unified_manifest_diff(base_manifest, normalized)`；`base_version` 原样；`ok = not errors`；`manifest_hash = result.manifest_hash`。
- `summarize_diff`（每条一行中文，顺序固定；`base` 为 None 时只输出「新建智能体」与当前配置概要）：
  - `模型：<旧> → <新>`（相同则不输出）
  - `系统提示：+<a> 行 / -<d> 行`（用 `difflib.ndiff` 统计）
  - `内置工具：新增 <names>`、`内置工具：移除 <names>`、`工具策略：<name> <旧> → <新>`（以 `compile_spec` 的 `ToolEntry` 名称与 policy 对比；base 也经 `compile_spec("base", 1, base)` 编译，失败则跳过工具对比并输出 `（基线版本无法解析，跳过工具对比）`）
  - `MCP 服务：新增 / 移除 <names>`、`技能：新增 / 移除 <id@version>`、`最大工具轮数：<旧> → <新>`、`元数据：变更键 <keys>`
  - 无任何变化 → `与基线版本内容相同（提交不会产生新版本）`
- `unified_manifest_diff`：两边 `json.dumps(x, ensure_ascii=False, indent=2, sort_keys=True).splitlines()`（base 为 None 时为空列表），`difflib.unified_diff(..., fromfile=f"v{base_version}" 或 "(none)", tofile="draft", lineterm="")`，`"\n".join(...)`；超 `MAX_DIFF_CHARS` 截断并追加 `\n…（差异过长已截断）`。
- `submit_draft`：请求体 `{"local_avatar_id", "display_name": display_name.strip()[:64], "description": (description or "").strip()[:500] or None, "manifest": dict(manifest)}`，`note` 非空时加 `"note": note.strip()[:500]`；`POST {base}/api/desktop/agents/publish`，其余与 D04 `publish_avatar_draft` 相同（`timeout=15.0`、`trust_env=False`、错误映射同一写法，`errors` 字段透传）。
- `render_preview(report)`：Markdown 文本，结构逐字：

```
## 预检结果：<通过 / 未通过>
<若有错误：### 需要修正\n- <error>…>
<若有提示：### 提示\n- <warning>…>
### 变更摘要（相对 v<base_version>，或「新建」）
- <summary line>…
### 差异
```diff
<diff>
```
```

### 4.2 `agenticx/cli/agent_tools.py`

1. `STUDIO_TOOLS` 在 `skill_manage` 的 schema 字典之后追加（逐字）：

```python
    {
        "type": "function",
        "function": {
            "name": "enterprise_agent_builder",
            "description": (
                "Create or modify enterprise managed-agent DRAFTS owned by the current user. "
                "Actions: list (my enterprise agents), get (manifest of a version), "
                "preview (validate a manifest and diff it against the latest version; no write), "
                "submit (after user confirmation, submit the manifest as a draft version; never publishes). "
                "Use only with the agenticx-enterprise-agent-builder skill."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "get", "preview", "submit"]},
                    "agent_id": {"type": "string", "description": "Existing enterprise agent id (get/preview/submit to modify)."},
                    "version": {"type": "integer", "minimum": 1, "description": "For get; default latest."},
                    "manifest": {"type": "object", "description": "agx.agent/v1 manifest (preview/submit)."},
                    "display_name": {"type": "string", "description": "Required for submit of a new agent; 1-64 chars."},
                    "description": {"type": "string"},
                    "note": {"type": "string", "description": "Version note, <= 500 chars."},
                },
                "required": ["action"],
            },
        },
    },
```

2. 分发：在 `if name == "skill_manage":`（当前 L13076）之前插入：

```python
        if name == "enterprise_agent_builder":
            return await _tool_enterprise_agent_builder(arguments, session, confirm_gate=gate, emit_event=event_callback)
```

3. 工具函数（放在 `_tool_skill_manage` 定义之后；`agenticx.runtime.enterprise_agent_builder` 的 import 写在文件顶部 import 区——若文件顶部对 `agenticx.runtime.*` 采用延迟导入惯例，则遵守 no-inline-imports 规则仍放顶部；如出现循环导入，按文件内既有处理方式并加英文注释说明）：

```python
async def _tool_enterprise_agent_builder(
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    ...
```

行为（逐条，返回字符串）：
- `settings = enterprise_publish_settings()`；None → `NOT_LOGGED_IN_TEXT`。
- `action` 不在四者之内 → `ERROR: action must be one of list, get, preview, submit`。
- `list` → `json.dumps({"agents": [asdict(d) for d in list_my_agents(...)]}, ensure_ascii=False)`；空列表时附 `"hint": "还没有通过 Near 提交的企业智能体，可以直接描述需求来新建。"`。
- `get` → 需要 `agent_id`（缺 → `ERROR: agent_id is required`）；返回 `json.dumps({"agent": …, "version": {"version", "manifest", "note", "created_at"}, "versions": […]}, ensure_ascii=False)`。
- `preview` → 需要 `manifest`（缺或非 dict → `ERROR: manifest must be an object`）；给了 `agent_id` 则先 `get_my_agent(agent_id, None)` 取最新版本为基线；返回 `render_preview(report)`。
- `submit`：
  1. 需要 `manifest`；`agent_id` 给定 → 取基线并要求该智能体 `lifecycle != "recalled"`（否则 `ERROR: 该智能体已被管理员回收，不能再提交`），`local_avatar_id` 取自 `list_my_agents` 中该 id 的记录（找不到 → `ERROR: 只能修改自己通过 Near 提交的企业智能体`），`display_name` 缺省用原名；`agent_id` 未给 → `display_name` 必填（1–64，否则 `ERROR: display_name is required (1-64 characters)`），`local_avatar_id = synth_local_id(display_name)`。
  2. `report = preview_manifest(...)`；`not report.ok` → 返回 `render_preview(report)`（不写）。
  3. 确认：

```python
        question = (
            "将以下配置作为企业智能体的**草稿版本**提交（不会发布，管理员发布后才生效）：\n"
            + "\n".join(f"- {line}" for line in report.summary)
        )
        approved = await _confirm(
            question,
            confirm_gate=confirm_gate,
            context={"tool": "enterprise_agent_builder", "risk": "enterprise_write"},
            emit_event=emit_event,
            session=session,
        )
        if not approved:
            return _cancelled("企业智能体草稿未提交", confirm_gate)
```

  4. `result = submit_draft(...)`；`EnterprisePublishError` → `f"ERROR: HTTP {exc.status} · {exc.message}"`，`exc.errors` 非空时追加换行列出。
  5. 成功文本（按结果选一，逐字模板）：
     - `created` 且 `lifecycle == "draft"`：`已提交为草稿 v{version}（智能体 {agent_id}）。管理员在管理台「智能体」中发布后，才会对员工生效。`
     - `created` 且 `routing_mode == "pinned"` 且 `effective_version != version`：`已提交新版本 v{version}，当前生效仍是 v{effective_version}。需管理员在管理台切换生效版本。`
     - `not created`：`内容与企业侧最新版本 v{version} 相同，未产生新版本。`
     - 其它：`已提交 v{version}（{lifecycle}，路由 {routing_mode}，当前生效 v{effective_version}）。`
     末尾统一追加两行：`\n\n变更摘要：\n` + 摘要列表。

### 4.3 `agenticx/runtime/tool_search.py`

`BUILTIN_DEFER_ALLOWLIST` 集合字面量中加入 `"enterprise_agent_builder",`（只加这一行）。

### 4.4 新建 `agenticx/skills/agenticx-enterprise-agent-builder/SKILL.md`（全文）

```markdown
---
name: agenticx-enterprise-agent-builder
description: Draft or modify an ENTERPRISE managed agent (企业智能体) from a natural-language request, preview the version diff, and submit it as a draft for admin review. Use when the user wants to build, change, or migrate an agent for their company's managed agent platform. Not for local desktop avatars (use agenticx-agent-builder for 本机分身).
metadata:
  author: AgenticX
  version: "0.1.0"
---

# 企业智能体构建（草稿）

帮助员工用自然语言起草企业智能体配置（`agx.agent/v1`），在对话里展示与企业侧最新版本的差异，确认后提交为**草稿**。发布永远由管理员在管理台完成。

## 硬性规则

1. 只用 `enterprise_agent_builder` 工具读写企业侧；看不到该工具时先调用 `tool_search` 搜索 `enterprise_agent_builder`。
2. **永远不要说「已发布」「已上线」「同事已经可以用了」**。提交成功只代表草稿或候选版本已保存。
3. 提交前必须先 `preview`，把「变更摘要」和 `diff` 代码块原样展示给用户，并得到用户明确同意后再 `submit`。
4. 不要把任何密钥、Token、密码、Cookie 写进配置或系统提示；需要访问外部系统时告诉用户「凭证由管理员在凭证库中配置」。
5. 只能修改用户自己通过 Near 提交的企业智能体；`list` 里没有的不要尝试修改。
6. 用户只是想要一个本机分身时，改用 `agenticx-agent-builder` 技能。

## 流程

1. **澄清**（最多两轮，优先给选项）：负责什么、给谁用、需要哪些能力（读写文件、执行命令、联网检索、读取文档）、哪些操作需要人工确认。
2. **修改已有智能体时**：先 `list`，再 `get` 取最新版本，在原配置上**只改用户要求的部分**，其余字段（含数组里未提到的项）原样保留。
3. **起草 Manifest**（见下方字段说明），调用 `preview`。
4. **展示**：照抄工具返回的「预检结果 / 变更摘要 / 差异」。有「需要修正」时先修正再 `preview`。
5. **确认后提交**：`submit`（新建时提供 `display_name`，可选 `description` 与 `note`）。把返回文本转述给用户，并提示「请联系管理员在管理台发布」。

## Manifest 字段（agx.agent/v1）

```json
{
  "schema": "agx.agent/v1",
  "model": "<providerId>/<modelName>",
  "system": "系统提示",
  "tools": [
    {"type": "agx_builtin", "default_policy": "always_allow",
     "configs": [{"name": "bash_exec", "policy": "always_ask"}]}
  ],
  "mcp_servers": [],
  "skills": [],
  "multiagent": null,
  "runtime": {"max_tool_rounds": 40, "max_session_tokens": null},
  "metadata": {"welcome_message": "", "suggested_questions": []}
}
```

- `model`：沿用基线版本的模型；新建时询问用户或保留企业常用模型名，格式必须是 `供应商/模型`。
- 内置工具只能从以下 14 个中选：`bash_exec`、`file_read`、`file_write`、`file_edit`、`list_files`、`code_outline`、`web_fetch`、`web_search`、`get_current_datetime`、`todo_write`、`scratchpad_read`、`scratchpad_write`、`liteparse`、`tool_result_recall`。未列出的工具会被拒绝。停用某个工具写 `{"name": "...", "enabled": false}`。
- 权限只有两档：`always_allow`（自动执行）与 `always_ask`（每次需要人工确认）。会写文件、执行命令、访问外网的工具建议 `always_ask`；无人值守的定时任务不要依赖 `always_ask`。
- `mcp_servers` 只写 `name`、`url`、`transport`（`http` 或 `sse`），**不能**写 `headers` 或 `env`。
- `skills` 只能引用企业技能库中已上架的技能（`{"source": "tenant", "id": "...", "version": null}`）；不确定时留空并提示用户联系管理员。
- `multiagent` 保持 `null`（多智能体协作由管理员配置）。

## 常见回复

- 未登录企业：请用户在「设置 → 企业」中登录。
- 提交返回 409「已被管理员回收」：说明该智能体已停用，建议新建。
- 「内容与最新版本相同」：说明没有产生新版本，无需再次提交。
```

### 4.5 web-portal 只读路由

`src/app/api/desktop/agents/drafts/route.ts`：

```ts
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const agents = await listAgentsWithMa(identity.tenantId);
  const mine = agents
    .filter((a) => a.origin === "employee" && a.ownerUserId === identity.userId && a.localAvatarId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return NextResponse.json({ agents: mine.map(toDraftSummary) });
}
```

`toDraftSummary`（同文件私有函数）字段：`agent_id`、`display_name`、`description`、`local_avatar_id`、`lifecycle`、`latest_version`、`effective_version`、`routing_mode`（= `versionRouting`）、`updated_at`（ISO）。字段名与 `EnterpriseAgentWithMa` 实际属性对齐（`updatedAt` 若为 Date 用 `toISOString()`；实施前核对）。

`src/app/api/desktop/agents/drafts/[agentId]/route.ts`：
- 鉴权同上；`getAgentWithMa(tenant, agentId)`：不存在或 `origin !== "employee"` 或 `ownerUserId !== identity.userId` → **404** `{"code":"40400","message":"智能体不存在"}`（不区分「不存在」与「不是你的」）。
- `version` 查询参数：缺省 `agent.latestVersion`；非正整数 → 400 `{"code":"40000","message":"version 不合法"}`；`getAgentVersion` 抛 `AgentVersionNotFoundError` → 404 `{"code":"40401","message":"版本不存在"}`。
- 响应：`{"agent": <toDraftSummary>, "version": {"version", "manifest", "manifest_hash", "note", "source", "created_at"}, "versions": listAgentVersions(tenant, id, {limit: 20}) 映射为 [{"version","note","source","created_at"}]}`。
- 只读：不调用任何写函数。

---

## 5. Before / After

| 场景 | Before | After |
|---|---|---|
| 员工想要一个「每周整理销售表」的企业智能体 | 只能找管理员手工配置，或先建本机分身再「发布到企业」 | 在 Near 对话描述需求 → 看到配置差异 → 确认 → 企业侧出现 `draft` 智能体 v1，管理员审核发布 |
| 修改已提交的企业智能体 | 只能从本机分身重新发布 | 对话中「给它加上联网检索」→ 只改 tools → 差异仅一行 → 提交为新版本；已发布时当前生效版本不变 |
| 个人会话 | — | 工具表默认不含 `enterprise_agent_builder`（延迟加载）；未登录企业时调用返回提示 |

---

## 6. 数据与协议

### 6.1 工具调用示例

```json
{"action": "preview", "agent_id": "01JB...", "manifest": {"schema": "agx.agent/v1", "model": "zhipu/glm-5", "system": "...",
  "tools": [{"type": "agx_builtin", "default_policy": "always_allow", "configs": [{"name": "web_search", "policy": "always_allow"}]}]}}
```

### 6.2 `GET /api/desktop/agents/drafts` 响应

```json
{"agents": [{"agent_id": "01JB...", "display_name": "销售周报", "description": null, "local_avatar_id": "nl-xiao-shou",
  "lifecycle": "draft", "latest_version": 2, "effective_version": 2, "routing_mode": "follow_latest",
  "updated_at": "2026-11-02T08:00:00.000Z"}]}
```

`local_avatar_id` 以 `nl-` 开头的是本工具新建的；其它是 D04 从本机分身提交的，同样可以在对话中修改（提交时沿用原 `local_avatar_id`）。

### 6.3 `GET /api/desktop/agents/drafts/{agentId}?version=2` 响应

```json
{"agent": { "...": "同 6.2 一项" },
 "version": {"version": 2, "manifest": {"schema": "agx.agent/v1", "...": "..."}, "manifest_hash": "sha256:...",
             "note": "加入联网检索", "source": "desktop", "created_at": "..."},
 "versions": [{"version": 2, "note": "加入联网检索", "source": "desktop", "created_at": "..."},
              {"version": 1, "note": null, "source": "desktop", "created_at": "..."}]}
```

### 6.4 写入

完全复用 `POST /api/desktop/agents/publish`（D04 §5），本文不改其请求 / 响应 / 错误码。

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 :: 断言） |
|---|---|---|
| FR-1 | 合成本机标识 | `tests/test_enterprise_agent_builder.py::test_synth_local_id`（`"Sales Weekly!"` → `"nl-sales-weekly"`；`"销售 周报"` → `"nl-" + sha256("销售 周报")[:16]`，且与 `"财务 月报"` 的结果不同；同一名称两次调用结果相同；结果均匹配 `^[A-Za-z0-9._-]{1,128}$`） |
| FR-2 | 预检 | `::test_preview_rejects_invalid_and_secrets`（未知内置工具 → errors 含 `unknown builtin tool`；system 含 `sk-live-abcdefghijklmnop1234`（用 monkeypatch 让 `redact_text` 识别该值）→ 错误 `检测到疑似密钥…`；含 `${cred:GH}` → `不能使用本机凭证引用…`；system 含 `/Users/alice/x` → 本机路径错误；合法 manifest → `ok`、`manifest_hash` 以 `sha256:` 开头） |
| FR-3 | 差异摘要 | `::test_summarize_diff`（base 关 `web_search`、新开启且 `bash_exec` 由 allow 改 ask、系统提示加 2 行 → 摘要含 `内置工具：新增 web_search`、`工具策略：bash_exec always_allow → always_ask`、`系统提示：+2 行 / -0 行`；相同内容 → `与基线版本内容相同（提交不会产生新版本）`；`unified_manifest_diff` 超长截断并带 `（差异过长已截断）`） |
| FR-4 | 列表 / 详情客户端 | `::test_list_and_get_use_device_token`（替身 `http_get` 记录：URL `https://portal.example/api/desktop/agents/drafts`、头 `Authorization: Bearer agx-pat-x`、`trust_env is False`；404 → `EnterprisePublishError.status == 404`；`httpx.ConnectError` → status 0、message `无法连接企业服务`） |
| FR-5 | 提交请求 | `::test_submit_draft_body`（body 键集合 `{local_avatar_id, display_name, description, manifest}`，有 note 时多 `note`；`display_name` 截断到 64） |
| FR-6 | 工具：未登录 | `tests/test_enterprise_agent_builder_tool.py::test_not_logged_in`（monkeypatch `enterprise_publish_settings` 返回 None → 返回值等于 `NOT_LOGGED_IN_TEXT`） |
| FR-7 | 工具：submit 必须确认 | `::test_submit_requires_confirmation`（确认门替身返回 False → 返回含 `企业智能体草稿未提交`，`submit_draft` 未被调用；返回 True → 调用一次且确认问题文本含 `草稿版本` 与摘要行） |
| FR-8 | 工具：只能改自己的 | `::test_submit_existing_requires_ownership`（`agent_id` 不在 `list_my_agents` 结果中 → `ERROR: 只能修改自己通过 Near 提交的企业智能体`，未调用提交） |
| FR-9 | 工具：预检失败不写 | `::test_submit_invalid_manifest_returns_preview`（非法 manifest → 返回文本以 `## 预检结果：未通过` 开头，未调用确认门与提交） |
| FR-10 | 工具：结果文案 | `::test_submit_result_messages`（四种返回体分别得到 §4.2 第 5 点的四种文案） |
| FR-11 | 延迟加载 | `::test_tool_is_deferred`（`agenticx.runtime.tool_search.is_deferred_builtin("enterprise_agent_builder") is True`；`STUDIO_TOOLS` 中恰有一个该名字的 schema） |
| FR-12 | 内置技能可发现 | `::test_builtin_skill_discovered`（扫描内置技能根，找到 `agenticx-enterprise-agent-builder`，`infer_skill_source(...) == "builtin"`，frontmatter `name` 与目录名一致；SKILL.md 中 14 个内置工具名全部出现，且与 `MANAGED_BUILTIN_TOOLS` 集合相等——用正则提取反引号内名称比对） |
| FR-13 | web-portal 列表 | `src/app/api/desktop/agents/drafts/__tests__/route.test.ts`（`vi.mock("@agenticx/iam-core")`、`vi.mock(".../desktop-auth")`）：`lists only my employee agents`（他人 / 企业 origin / 无 localAvatarId 的被过滤，按 `updated_at` 倒序，字段名 snake_case）；无令牌 → 401 |
| FR-14 | web-portal 详情 | 同文件：`returns 404 for others' agent`；`defaults to latest version`；`bad version → 400`；`missing version → 404 40401`；`versions limited to 20`；断言未调用任何 iam-core 写函数（`createAgentVersion`、`updateAgentMaSettings` 的 mock 调用次数为 0） |
| NFR-1 | 个人模式不变 | `pytest tests/test_agent_tools*.py -q` 与 `pytest tests/test_studio_server.py -q`（三个既有失败除外）通过；冷启动 smoke（临时 HOME）`/api/sessions` 200 |
| NFR-2 | 托管白名单不变 | `tests/managed/test_spec.py` 通过；`"enterprise_agent_builder" not in MANAGED_BUILTIN_TOOLS` |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/test_enterprise_agent_builder.py tests/test_enterprise_agent_builder_tool.py -q
pytest tests/managed/test_spec.py -q
pytest tests/test_studio_server.py -q     # 三个既有失败不算回归
pnpm -C enterprise --filter @agenticx/web-portal test
pnpm -C enterprise --filter @agenticx/web-portal typecheck

# 冷启动 smoke（必须临时 HOME，见契约备忘全局规则）
TMPH=$(mktemp -d); HOME=$TMPH agx serve --host 127.0.0.1 --port 18766 & sleep 40; \
  curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18766/api/sessions; kill %1

# 手工演示：Near 登录企业 → 新对话「帮我做一个每周整理销售表的企业智能体，需要读写文件，执行命令要先问我」
# → 看到预检与差异 → 同意 → 管理台「智能体」出现草稿 v1；再说「给它加上联网检索」→ 差异只有 web_search → 提交 v2
```

---

## 9. 回滚

- 无运行时开关：工具默认延迟加载、只在技能指引下被调用；未登录企业时无副作用。需要紧急停用时，删除 `agenticx/skills/agenticx-enterprise-agent-builder/` 目录即可让模型不再被引导使用（工具仍需显式 `tool_search` 才会加载）。
- 代码回滚：删除新建文件，`git checkout` 三个修改文件（`agent_tools.py`、`tool_search.py`）。已提交到企业的草稿版本保留，由管理员处置。

---

## 10. 不变量

1. 本子规划新增的企业端路由全部只读；所有写入仍只经 D04 的发布接口，服务端「新建为草稿、已发布先固定生效版本」的语义不变。
2. 本工具从不发布、不回收、不切换路由。
3. 个人模式工具表、确认策略、`/api/chat` 行为不变；`agent_tools.py` 只新增一个 schema、两行分发、一个函数。
4. 托管内置工具白名单（14 个）不变。
5. 设备令牌不出现在工具返回文本、日志与异常消息中。

---

## 11. 须登记 master §12 / 待用户确认

- **登记**：① MA-D05 不依赖 MA-E11，凭证为 Near 设备令牌、写入经 MA-D04 桌面发布接口（服务端保证只出草稿），master §9 MA-D05 行「经 `ma:` API」与依赖列相应改写；② web-portal 新增只读路由 `GET /api/desktop/agents/drafts` 与 `GET /api/desktop/agents/drafts/:agentId`（第 0 节规则 1 的登记例外，同 MA-D02 / MA-D04）；③ 合成本机标识前缀 `nl-` 的约定；④ 新内置工具 `enterprise_agent_builder` 进入延迟加载名单。
- **待确认**：Q1 员工只能改自己提交的企业智能体（不能改管理员创建的），是否接受；Q2 新建的企业智能体默认 `desktop_worker` 运行、仅分配给本人（沿用 D04），是否接受；Q3 差异以对话文本展示、不新增 Near 专用 UI，是否接受。
