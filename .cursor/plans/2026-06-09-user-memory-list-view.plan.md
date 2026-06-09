# 用户记忆（MEMORY.md）列表视图与可编辑展示

Plan-Id: 2026-06-09-user-memory-list-view
Plan-File: .cursor/plans/2026-06-09-user-memory-list-view.plan.md

> ## 执行者须知（必读）
> - 本计划**只新增/修改以下 6 个文件**，**绝不**改动其它文件（遵守 `no-scope-creep.mdc`）：
>   1. `agenticx/workspace/loader.py`（新增 3 个函数）
>   2. `agenticx/studio/server.py`（新增 4 个路由）
>   3. `desktop/src/components/memory/memory-graph-types.ts`（加类型）
>   4. `desktop/src/components/memory/memory-graph-api.ts`（加 4 个函数 + 改 `deriveGroupId`）
>   5. `desktop/src/components/memory/MemoryGraphExplorer.tsx`（加 user scope，**不重构现有逻辑**）
>   6. `desktop/src/components/memory/WorkspaceMemoryList.tsx`（新建）
>   + `tests/test_workspace_memory_entries.py`（新建测试）
> - **严禁改动 Graphiti/Kuzu 图谱逻辑**、`MemoryGraphCanvas.tsx`、`MemoryGraphDetail.tsx`、`recall.py`、`group_id.py`、`config.yaml`。
> - **严禁重构 `MemoryGraphExplorer.tsx` 的 `reload`/`loadConfig`/effects 已有结构**，只能按第 5 节做"加分支"式的最小侵入修改。
> - Python 遵守 `.cursor/rules/google-python-style.mdc`：英文注释/docstring、文件头 `Author: Damon Li`、全包名 import、无 emoji。
> - 每改完一个文件，按文末「实现顺序与自检」逐项核对再进入下一个。
> - 改完前端后必须跑 `cd desktop && npm run typecheck`（或 `npx tsc --noEmit`）确认无类型错误。

## 背景与问题

当前「记忆」弹窗（组件 `MemoryGraphExplorer`，文件 `desktop/src/components/memory/MemoryGraphExplorer.tsx`）只可视化 **Graphiti + Kuzu 图谱**，提供三个 scope：

| Tab | 后端分区 group_id | 数据来源 |
|---|---|---|
| 元智能体 | `meta_default` | 对话 turn 异步 ingest 的实体/关系/Episode |
| 分身 | `avatar_<id>` | 同上，按分身隔离 |
| 群聊 | `group_<gid>` | 同上，按群聊隔离 |

而**用户级长期记忆** `~/.agenticx/workspace/MEMORY.md`（由 `WorkspaceMemoryStore` 索引，SQLite FTS + hybrid）是**另一套独立体系**：

- 不进 Kuzu 图谱，所以图谱视图里看不到 MEMORY.md 内容。
- 前端**没有任何页面展示 MEMORY.md 全文**；它只在系统提示注入、`memory_search` 工具返回片段中间接出现。
- 用户感知为「用户记忆在后台默默工作但前端无展示位」。

`MEMORY.md` 由 `ensure_workspace`（`agenticx/workspace/loader.py`）初始化，模板结构固定：

```
# Long-Term Memory

This file stores long-term memory anchors for the agent.

## User Preferences

## Key Facts

## Important Context

```

条目 = 各 `## Section` 下的 `- ` 列表项（现有 `append_long_term_memory` 追加 `- {content}`）。

本计划只聚焦**全局 `~/.agenticx/workspace/MEMORY.md`**，新增**可编辑列表视图**，与图谱视图在同一弹窗内按 scope 并存。

## 目标与非目标

### 目标

- FR-1：记忆弹窗新增「用户」scope tab，展示全局 `MEMORY.md` 的结构化条目（列表视图）。
- FR-2：列表按 `## Section` 分组，每个 `- `/`* ` 列表项为一条可操作条目。
- FR-3：条目级**新增 / 编辑 / 删除**，写回 `MEMORY.md` 后自动 `index_workspace_sync` 重建索引。
- FR-4：「用户」scope 强制列表视图；元智能体/分身/群聊保持图谱视图，行为不变。
- NFR-1：写操作走与现有 `/api/memory/*` 一致的 token 校验（`_check_token` + `x-agx-desktop-token` header）。
- NFR-2：写回 `MEMORY.md` 只增删改指定 `- ` 行，保留标题、说明段落、空行。

### 非目标

- 不改图谱逻辑、不改 `MemoryGraphCanvas`/`MemoryGraphDetail`。
- 不纳入 `memory/*.md` 日记、`IDENTITY/USER/SOUL.md`、`favorites.json`。
- 不做分身/群聊维度的用户记忆隔离（MEMORY.md 始终全局）。
- 不改 `recall.py`、不给 meta/avatar/group 三个 scope 加 list 视图。

---

## 后端改动

### 1. `agenticx/workspace/loader.py` —— 新增 3 个纯函数

在文件**末尾**（现有 `append_daily_memory` 之后）新增。需在文件顶部已有 import 基础上补 `import re`（若尚无）。

条目数据模型：`{ "section": str, "index": int, "text": str, "line": int }`
- `section`：所属 `## ` 标题文本（不含 `## ` 前缀）。
- `index`：该 section 内第几条列表项，**从 0 开始，是唯一稳定定位键**。
- `text`：去掉行首 `- `/`* ` 后的内容。
- `line`：1-based 行号（仅展示用，**不作定位键**）。

可直接采用的实现（按本仓库 Python 风格，英文注释）：

```python
import re

_MEMORY_LIST_ITEM_RE = re.compile(r"^\s*[-*]\s+(.*)$")


def read_memory_entries(workspace_dir: Path) -> List[dict]:
    """Parse MEMORY.md into structured list entries grouped by section.

    Args:
        workspace_dir: The workspace directory.

    Returns:
        A flat list of entries, each with section, index (0-based within the
        section), text (marker stripped) and 1-based line number.
    """
    memory_file = workspace_dir / "MEMORY.md"
    if not memory_file.exists():
        return []
    lines = memory_file.read_text(encoding="utf-8", errors="replace").splitlines()
    current_section = ""
    counters: dict[str, int] = {}
    entries: List[dict] = []
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith("## "):
            current_section = stripped[3:].strip()
            counters.setdefault(current_section, 0)
            continue
        match = _MEMORY_LIST_ITEM_RE.match(raw)
        if match and current_section:
            idx = counters[current_section]
            entries.append(
                {
                    "section": current_section,
                    "index": idx,
                    "text": match.group(1).strip(),
                    "line": i + 1,
                }
            )
            counters[current_section] = idx + 1
    return entries


def _locate_entry_line(lines: List[str], section: str, index: int) -> int:
    """Return the 0-based line number of the index-th list item under section.

    Raises:
        ValueError: When the section or the index-th item cannot be found.
    """
    current_section = ""
    counter = 0
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith("## "):
            current_section = stripped[3:].strip()
            counter = 0
            continue
        if current_section != section:
            continue
        if _MEMORY_LIST_ITEM_RE.match(raw):
            if counter == index:
                return i
            counter += 1
    raise ValueError(f"memory entry not found: section={section!r} index={index}")


def update_memory_entry(workspace_dir: Path, section: str, index: int, new_text: str) -> None:
    """Replace the text of one MEMORY.md list entry, preserving everything else."""
    memory_file = workspace_dir / "MEMORY.md"
    if not memory_file.exists():
        ensure_workspace(workspace_dir)
    lines = memory_file.read_text(encoding="utf-8", errors="replace").split("\n")
    target = _locate_entry_line(lines, section, index)
    lines[target] = f"- {new_text.strip()}"
    memory_file.write_text("\n".join(lines), encoding="utf-8")


def delete_memory_entry(workspace_dir: Path, section: str, index: int) -> None:
    """Delete one MEMORY.md list entry, keeping the section heading intact."""
    memory_file = workspace_dir / "MEMORY.md"
    if not memory_file.exists():
        ensure_workspace(workspace_dir)
    lines = memory_file.read_text(encoding="utf-8", errors="replace").split("\n")
    target = _locate_entry_line(lines, section, index)
    del lines[target]
    memory_file.write_text("\n".join(lines), encoding="utf-8")
```

> 关键不变量：定位**只用 section + 序号**，绝不按文本匹配（避免同名条目误删）；`update`/`delete` 用与 `read` 完全一致的遍历规则，保证前端拿到的 `index` 与后端定位一致。

### 2. `agenticx/studio/server.py` —— 新增 4 个路由

定位现有路由块：`GET /api/memory/favorites`（约 L4868）、`POST /api/memory/save`（约 L4887）。**在 `memory_save` 之后、同一缩进层级**新增以下 4 个路由。写法照抄 `memory_save`：`payload: dict[str, Any]` 接 body、`x_agx_desktop_token: Optional[str] = Header(default=None)` + `_check_token(...)`。FastAPI 对 DELETE/PATCH 带 dict body 原生支持，无需 `Body(...)`。

公共 reindex 片段（每个写路由结尾复用）：

```python
cfg = _load_config_dict()
workspace_dir = resolve_workspace_dir(cfg)
# ... 调用 loader 函数（见下）...
try:
    from agenticx.memory.workspace_memory import WorkspaceMemoryStore

    WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
except Exception as exc:
    logger.warning("workspace reindex after memory edit failed: %s", exc)
return {"ok": True}
```

| 方法 | 路由 | body | 行为 |
|---|---|---|---|
| GET | `/api/memory/workspace` | — | 调 `read_memory_entries`，按 `section` 聚合（保持出现顺序）返回 `{ "sections": [{ "section", "entries": [{ "index", "text", "line" }] }], "path": str }` |
| POST | `/api/memory/workspace/entry` | `{ section?, text }` | `append_long_term_memory(workspace_dir, text, section=section or "Key Facts")` + reindex |
| PATCH | `/api/memory/workspace/entry` | `{ section, index, text }` | `update_memory_entry(...)` + reindex |
| DELETE | `/api/memory/workspace/entry` | `{ section, index }` | `delete_memory_entry(...)` + reindex |

- import：`from agenticx.workspace.loader import (append_long_term_memory, read_memory_entries, update_memory_entry, delete_memory_entry, resolve_workspace_dir)`（在路由函数内 import，与 `memory_save` 现有风格一致）。
- 空 `text`（POST/PATCH）→ `raise HTTPException(status_code=400, detail="empty text")`。
- 捕获 loader 抛出的 `ValueError` → `raise HTTPException(status_code=400, detail=str(exc))`。
- `path` 字段返回 `str(workspace_dir / "MEMORY.md")`。

---

## 前端改动（Desktop）

> api 客户端约定：本目录所有 fetch 函数签名都是 `(apiBase: string, apiToken: string, ...)` 显式传参（见 `memory-graph-api.ts`），**不要用 props 对象**。`MemoryGraphExplorer` 已有 props `apiBase` / `apiToken`，直接透传给新组件。

### 3. `desktop/src/components/memory/memory-graph-types.ts`

- 改 `MemoryGraphScope`（当前 L42）为：
  ```ts
  export type MemoryGraphScope = "avatar" | "meta" | "group" | "user";
  ```
- 文件末尾追加：
  ```ts
  export type WorkspaceMemoryEntry = { index: number; text: string; line: number };
  export type WorkspaceMemorySection = { section: string; entries: WorkspaceMemoryEntry[] };
  export type WorkspaceMemoryDoc = { sections: WorkspaceMemorySection[]; path: string };
  ```

### 4. `desktop/src/components/memory/memory-graph-api.ts`

- `deriveGroupId`（当前 L45）函数体**第一行**加：
  ```ts
  if (scope === "user") return "";
  ```
- 文件末尾追加 4 个函数（复用文件内已有的 `headers()`，base url 用入参 `apiBase`）：
  ```ts
  import type { WorkspaceMemoryDoc } from "./memory-graph-types"; // 合并进顶部已有的 type import

  export async function fetchWorkspaceMemory(
    apiBase: string,
    apiToken: string,
  ): Promise<WorkspaceMemoryDoc> {
    const r = await fetch(`${apiBase}/api/memory/workspace`, { headers: headers(apiToken) });
    if (!r.ok) throw new Error(`workspace memory ${r.status}`);
    const data = (await r.json()) as Partial<WorkspaceMemoryDoc>;
    return { sections: data.sections || [], path: data.path || "" };
  }

  export async function createWorkspaceEntry(
    apiBase: string, apiToken: string, section: string, text: string,
  ): Promise<void> {
    const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
      method: "POST", headers: headers(apiToken),
      body: JSON.stringify({ section, text }),
    });
    if (!r.ok) throw new Error(`create entry ${r.status}`);
  }

  export async function updateWorkspaceEntry(
    apiBase: string, apiToken: string, section: string, index: number, text: string,
  ): Promise<void> {
    const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
      method: "PATCH", headers: headers(apiToken),
      body: JSON.stringify({ section, index, text }),
    });
    if (!r.ok) throw new Error(`update entry ${r.status}`);
  }

  export async function deleteWorkspaceEntry(
    apiBase: string, apiToken: string, section: string, index: number,
  ): Promise<void> {
    const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
      method: "DELETE", headers: headers(apiToken),
      body: JSON.stringify({ section, index }),
    });
    if (!r.ok) throw new Error(`delete entry ${r.status}`);
  }
  ```

### 5. `desktop/src/components/memory/MemoryGraphExplorer.tsx` —— 最小侵入加 user scope

这是最易出错的文件，**严格按以下 4 处改，不要动其它逻辑**。

**5.1 `scopeLabel`（当前 L83–87）必须显式加 user 分支。**
现状最后一行 `return "元智能体"` 是兜底，**不加分支 user 会被错标为「元智能体」**：
```ts
function scopeLabel(scope: MemoryGraphScope): string {
  if (scope === "avatar") return "分身";
  if (scope === "group") return "群聊";
  if (scope === "user") return "用户";
  return "元智能体";
}
```

**5.2 scope tab 数组（当前 L501 附近 `(["avatar", "meta", "group"] as MemoryGraphScope[])`）追加 `"user"`：**
```ts
(["avatar", "meta", "group", "user"] as MemoryGraphScope[]).map((s) => (
```

**5.3 `reload`（当前 L254 起的 useCallback）开头加 user scope 早退，避免触发图谱请求。**
在 `setLoading(true); setError(null);` 之后、`try {` 之前（即 L260 附近）插入：
```ts
if (scope === "user") {
  setDisabled(false);
  setStatusHint(null);
  setBuildProgress(null);
  setGraph(EMPTY_GRAPH);
  setEpisodes([]);
  setLoading(false);
  return;
}
```
> 这样 user scope 完全不调用 overview/episodes/status 之外的图谱接口，也不会命中 `if (!groupId)` 的「不是分身会话」空态。`reload` 的依赖数组已含 `scope`，无需改依赖。

**5.4 渲染注入：两个 return 分支都要处理（dashboard 与 sidebar）。**
在组件内、`if (isDashboard)`（当前 L894）之前定义一个标志和列表节点：
```tsx
const isUserScope = scope === "user";
const userListArea = (
  <WorkspaceMemoryList apiBase={apiBase} apiToken={apiToken} />
);
```
然后：
- **dashboard 分支**（L894–916）：把中间那段 `<div className="flex h-[440px] ...">...</div>`（含 leftRail/canvasArea/legend/rightRail）整体用条件替换：
  ```tsx
  {isUserScope ? (
    <div className="h-[440px] shrink-0 overflow-y-auto">{userListArea}</div>
  ) : (
    <div className="flex h-[440px] shrink-0 gap-3">
      {leftRail}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-h-0 flex-1">{canvasArea}</div>
        {legend}
      </div>
      {rightRail}
    </div>
  )}
  ```
  （`configStrip` 保留在 user scope 下也可见，无妨。）
- **sidebar 分支**（L918–942）：把 `<div className="min-h-0 flex-1 p-2">{canvasArea}</div>` 及其下方 Episode 时间轴块用条件替换：
  ```tsx
  {isUserScope ? (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{userListArea}</div>
  ) : (
    <>
      <div className="min-h-0 flex-1 p-2">{canvasArea}</div>
      <div className="max-h-[42%] space-y-2 overflow-y-auto border-t border-border px-3 py-2">
        {/* 原有 MemoryGraphDetail + Episode 时间轴块原样保留在此 */}
      </div>
    </>
  )}
  ```
- 顶部 import 加：`import { WorkspaceMemoryList } from "./WorkspaceMemoryList";`
- **不要**改 `loadConfig`、`default_scope` 下拉、配置区（user 不进 config 默认范围）。

### 6. 新建 `desktop/src/components/memory/WorkspaceMemoryList.tsx`

- props：`{ apiBase: string; apiToken: string }`。
- 挂载时 `fetchWorkspaceMemory(apiBase, apiToken)`，存 `sections`。
- 渲染：每个 section 一个标题 + 其条目列表；每条目一行展示 `text`，行内提供「编辑 / 删除」按钮（按用户偏好，操作按钮可常驻显示）。
- 顶部「+ 新增记忆」：section 选择（下拉用已有 sections，默认 `Key Facts`，允许直接选已存在 section）+ 文本框 → `createWorkspaceEntry`。
- 编辑：内联 `textarea` + 保存 → `updateWorkspaceEntry(apiBase, apiToken, section, index, text)`。
- 删除：**用应用内主题化确认弹窗，禁止原生 `window.confirm`**（用户硬性偏好）→ `deleteWorkspaceEntry(...)`。
- 每次写操作成功后重新 `fetchWorkspaceMemory` 回填（可乐观更新 + 回填）。
- 加载中/空态/错误都要有可读提示。
- 全用主题 token（`bg-surface-card`、`text-text-*`、`border-border`、`var(--ui-btn-primary-*)`），不硬编码颜色。

---

## 验收标准

- AC-1：记忆弹窗（聊天侧栏 + 设置「记忆」Tab 两处入口）都出现第 4 个 tab，标签显示「用户」（非「元智能体」），点击后展示 `MEMORY.md` 分组条目列表。
- AC-2：新增一条记忆 → `MEMORY.md` 对应 section 末尾多出 `- <text>`，列表即时刷新。
- AC-3：编辑/删除某条目 → 文件对应行被改/删，**同名其他条目、标题、说明段落不受影响**。
- AC-4：每次写操作后 `WorkspaceMemoryStore` 索引重建（`memory_search` 工具能检索到新增内容）。
- AC-5：切到 元智能体/分身/群聊 时图谱行为与改动前**完全一致**（不触发用户记忆请求，无新增报错/空态）。
- AC-6：缺 token 调 workspace 写接口返回鉴权错误（与现有 `/api/memory/*` 一致）。
- AC-7：`cd desktop && npm run typecheck` 无类型错误；后端无新 lint。

## 影响面 / 风险

- 写回 `MEMORY.md` 的解析-改写是后端主要风险点：用「section + 序号」定位、`_locate_entry_line` 与 `read_memory_entries` 规则一致；处理空文件/无 section/越界 index。
- `MemoryGraphExplorer.tsx` 的两处渲染注入 + `reload` 早退是前端主要风险点：必须两个 return 分支都改，否则侧栏或设置页其一不显示列表。
- 索引重建为同步调用，MEMORY.md 体量小（KB 级），性能可忽略。
- 不影响打包、不引入新依赖。

## 测试

- 新建 `tests/test_workspace_memory_entries.py`（用 `tmp_path` 造 workspace + MEMORY.md）：
  - `read_memory_entries`：模板文件、含多条目、**含同名条目**、空/不存在文件。
  - `update_memory_entry`：按 index 精确改中目标、其它行（标题/说明段/同名条目）原样保留。
  - `delete_memory_entry`：按 index 精确删、section 标题保留。
  - 越界 index / 不存在 section → 抛 `ValueError`。
- 手动冒烟：`agx serve` 起后，Desktop 弹窗 user tab 增删改 → 核对 `~/.agenticx/workspace/MEMORY.md` 与 `memory_search` 返回。

## 实现顺序与自检（建议按序执行）

1. **loader.py 三函数** → 写 `tests/test_workspace_memory_entries.py` → `pytest tests/test_workspace_memory_entries.py` 全绿。
2. **server.py 四路由** → 手动 `curl`（带 `x-agx-desktop-token`）验证 GET/POST/PATCH/DELETE 各返回预期，越界返回 400。
3. **types.ts + api.ts** → `npm run typecheck` 绿。
4. **WorkspaceMemoryList.tsx**（独立组件，先能渲染 + 拉取）。
5. **MemoryGraphExplorer.tsx 4 处改动** → `npm run typecheck` 绿 → 起 Desktop 验 AC-1/AC-5（重点确认切回 meta/avatar/group 图谱无回归）。
6. 跑完 AC-1~AC-7。

## 提交

- `/commit --spec=.cursor/plans/2026-06-09-user-memory-list-view.plan.md`，commit message 含 `Plan-Id` / `Plan-File` / `Made-with: Damon Li` trailer，且**只 `git add` 本计划列出的 6 个文件 + 测试文件**。
