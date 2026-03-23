---
name: ""
overview: ""
todos: []
isProject: false
---

# AgenticX 扩展生态体系 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 AgenticX 差异化的三层扩展体系（Skills + MCP + AGX Bundle），补齐 Desktop 可见性，并为后续市场化铺路。

**Architecture:** 分三个 Phase 递进实施。Phase 1 补齐现有 Skills 在 Desktop 的可见性和管理能力（纯 UI + 已有后端的对接）。Phase 2 定义并实现 AGX Bundle 格式（AgenticX 独有的打包标准，包含 skills + mcp + avatars + memory_templates）。Phase 3 实现多源注册表发现与安装。

**Tech Stack:** Python (FastAPI) / TypeScript (React + Zustand) / Electron IPC / YAML

---

## 背景与动机

### 现状


| 层             | 后端                                                                               | Desktop GUI     | 差距   |
| ------------- | -------------------------------------------------------------------------------- | --------------- | ---- |
| MCP           | `MCPHub` + `mcp.json` 多路径合并 + Studio API                                         | 有「MCP 服务」Tab    | 已可用  |
| Skills        | `SkillBundleLoader` 扫描 + `SkillTool` 工具 + `registry.py` 远程注册表 + `agx skills` CLI | **无 Tab，用户不可见** | 严重缺失 |
| Bundle/Plugin | 不存在                                                                              | 不存在             | 全新需求 |


### 竞品参考

- **ClawHub (OpenClaw)**：中心化 npm 式市场，Skill + Plugin 分离，33k+ Skills
- **WorkBuddy (CodeBuddy)**：`marketplace.json` 多源分发，plugins 含 skills/commands/hooks/agents，SkillHub 腾讯生态绑定
- **Claude Code**：六类组件（commands/skills/agents/hooks/mcp/lsp），渐进式披露，去中心化社区市场
- **Cursor**：Plugin Marketplace，MCP 为核心扩展协议，Rules + Skills

### AgenticX 差异化定位

AgenticX 独有的**编排层能力**（Avatars 分身 + Group Chat 群聊 + Memory Pipeline + Meta-Agent 路由）是 ClawHub/WorkBuddy/Claude Code 均不具备的。扩展体系的差异化应围绕此构建。

---

## 需求定义

### FR (Functional Requirements)

- **FR-1**: Desktop 设置面板新增「技能」Tab，展示所有已扫描 Skills，支持开关/搜索/详情查看
- **FR-2**: Studio 后端新增 `/api/skills/`* REST API（list / detail / toggle / refresh）
- **FR-3**: Electron 主进程新增 IPC bridge 转发 skill API 调用
- **FR-4**: 定义 AGX Bundle 格式规范（`agx-bundle.yaml` manifest）
- **FR-5**: 实现 Bundle 解析器，能从本地目录或 `.tar.gz` 安装 Bundle
- **FR-6**: Desktop 新增「扩展」Tab（或在技能 Tab 内分区），展示已安装 Bundles
- **FR-7**: 多源注册表支持：官方源 + 社区源 + 本地源扫描

### NFR (Non-Functional Requirements)

- **NFR-1**: Skills 列表加载 < 200ms（已有 `SkillBundleLoader` 缓存机制）
- **NFR-2**: Bundle manifest 解析采用防御式编程，格式错误不 crash
- **NFR-3**: 安全：Bundle 安装时禁止路径穿越；MCP 命令须经用户确认策略
- **NFR-4**: 向后兼容：不破坏现有 `~/.agenticx/config.yaml` 和 `mcp.json` 格式

### AC (Acceptance Criteria)

- **AC-1**: 打开设置面板 → 「技能」Tab → 能看到所有本地 + 全局 Skills 列表
- **AC-2**: 点击某 Skill 能查看完整 SKILL.md 内容
- **AC-3**: 能从 ClawHub / 本地目录安装新 Skill 并在列表中显示
- **AC-4**: AGX Bundle manifest 能正确解析 skills + mcp_servers + avatars + memory_templates 四个组件
- **AC-5**: 从本地目录安装 Bundle 后，其中的 Skills 在列表可见，MCP 在 MCP Tab 可见

---

## Phase 1: Desktop Skills Tab + Studio API

> 最小成本补齐已有能力的 Desktop 可见性

### Task 1: Studio Skills REST API

**Files:**

- Modify: `agenticx/studio/server.py`
- Reference: `agenticx/cli/studio_skill.py` (existing helpers)
- Reference: `agenticx/tools/skill_bundle.py` (SkillBundleLoader)

**Step 1: Add `/api/skills` endpoint to Studio server**

在 `server.py` 的路由注册区域添加 Skills API endpoints：

```python
@app.get("/api/skills")
async def list_skills(session_id: str = "") -> dict:
    """List all available skills with metadata."""
    from agenticx.cli.studio_skill import get_all_skill_summaries
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader()
    skills = loader.scan()
    items = []
    for s in skills:
        items.append({
            "name": s.name,
            "description": s.description,
            "location": s.location,
            "base_dir": str(s.base_dir),
        })
    return {"ok": True, "items": items, "count": len(items)}

@app.get("/api/skills/{name}")
async def get_skill_detail(name: str) -> dict:
    """Get full SKILL.md content for a skill."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader()
    content = loader.get_skill_content(name)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")
    meta = loader.get_skill(name)
    return {
        "ok": True,
        "name": name,
        "description": meta.description if meta else "",
        "location": meta.location if meta else "",
        "content": content,
    }

@app.post("/api/skills/refresh")
async def refresh_skills() -> dict:
    """Force rescan skill directories."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader()
    skills = loader.refresh()
    return {"ok": True, "count": len(skills)}
```

**Step 2: Verify endpoints respond correctly**

Run: `curl http://localhost:PORT/api/skills` after starting Studio
Expected: JSON with `ok: true` and `items` array

**Step 3: Commit**

```bash
git add agenticx/studio/server.py
git commit -m "feat(studio): add /api/skills REST endpoints for skill listing and detail

FR-1, FR-2: Expose SkillBundleLoader results via Studio HTTP API
so Desktop frontend can discover and display skills.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 2: Electron IPC Bridge for Skills

**Files:**

- Modify: `desktop/electron/main.ts` (add IPC handlers)
- Modify: `desktop/electron/preload.ts` (expose to renderer)

**Step 1: Add IPC handlers in main.ts**

在 main.ts 的 IPC handler 注册区域（靠近 `loadEmailConfig`、`importMcpConfig` 等已有 handler），添加：

```typescript
ipcMain.handle("load-skills", async (_event) => {
  const studioUrl = getStudioUrl();
  const token = getDesktopToken();
  if (!studioUrl) return { ok: false, error: "Studio not connected", items: [] };
  try {
    const resp = await fetch(`${studioUrl}/api/skills`, {
      headers: { "x-agx-desktop-token": token },
    });
    return await resp.json();
  } catch (err) {
    return { ok: false, error: String(err), items: [] };
  }
});

ipcMain.handle("load-skill-detail", async (_event, args: { name: string }) => {
  const studioUrl = getStudioUrl();
  const token = getDesktopToken();
  if (!studioUrl) return { ok: false, error: "Studio not connected" };
  try {
    const resp = await fetch(`${studioUrl}/api/skills/${encodeURIComponent(args.name)}`, {
      headers: { "x-agx-desktop-token": token },
    });
    return await resp.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("refresh-skills", async (_event) => {
  const studioUrl = getStudioUrl();
  const token = getDesktopToken();
  if (!studioUrl) return { ok: false, error: "Studio not connected" };
  try {
    const resp = await fetch(`${studioUrl}/api/skills/refresh`, {
      method: "POST",
      headers: { "x-agx-desktop-token": token },
    });
    return await resp.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

**Step 2: Expose via preload.ts**

```typescript
loadSkills: () => ipcRenderer.invoke("load-skills"),
loadSkillDetail: (args: { name: string }) => ipcRenderer.invoke("load-skill-detail", args),
refreshSkills: () => ipcRenderer.invoke("refresh-skills"),
```

**Step 3: Add TypeScript declarations**

在 `desktop/src/global.d.ts` 或相应类型文件中补充：

```typescript
loadSkills: () => Promise<{ ok: boolean; items: SkillItem[]; count: number; error?: string }>;
loadSkillDetail: (args: { name: string }) => Promise<{ ok: boolean; name: string; description: string; location: string; content: string; error?: string }>;
refreshSkills: () => Promise<{ ok: boolean; count: number; error?: string }>;
```

**Step 4: Commit**

```bash
git add desktop/electron/main.ts desktop/electron/preload.ts desktop/src/global.d.ts
git commit -m "feat(desktop): add Electron IPC bridge for skills API

FR-3: Expose loadSkills/loadSkillDetail/refreshSkills IPC handlers
bridging Desktop renderer to Studio /api/skills/* endpoints.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 3: Desktop「技能」Tab UI

**Files:**

- Modify: `desktop/src/components/SettingsPanel.tsx`

**Step 1: Add "skills" to SettingsTab type and TABS constant**

```typescript
// 修改 SettingsTab type
type SettingsTab = "general" | "provider" | "mcp" | "skills" | "email" | "workspace" | "favorites";

// 在 TABS 数组中，在 "mcp" 之后插入：
import { Sparkles } from "lucide-react";
// ...
{ id: "skills", label: "技能", icon: Sparkles },
```

**Step 2: Create SkillsTab component**

在 `SettingsPanel.tsx` 内部（或抽取到独立文件 `SkillsTab.tsx`），创建：

```tsx
type SkillItem = {
  name: string;
  description: string;
  location: string;
  base_dir: string;
};

function SkillsTab() {
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ name: string; content: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await window.agenticxDesktop.loadSkills();
        if (!cancelled) {
          if (res.ok) setItems(res.items ?? []);
          else setErr(res.error ?? "加载失败");
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onRefresh = async () => {
    setLoading(true);
    setErr("");
    try {
      await window.agenticxDesktop.refreshSkills();
      const res = await window.agenticxDesktop.loadSkills();
      if (res.ok) setItems(res.items ?? []);
      else setErr(res.error ?? "刷新失败");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onViewDetail = async (name: string) => {
    try {
      const res = await window.agenticxDesktop.loadSkillDetail({ name });
      if (res.ok) setDetail({ name, content: res.content });
    } catch (e) {
      setErr(String(e));
    }
  };

  const filtered = search.trim()
    ? items.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  // ... 渲染逻辑：搜索框 + 刷新按钮 + 技能列表卡片 + 详情面板
}
```

UI 要求：

- 顶部：搜索输入框 + 「刷新」按钮
- 列表：每行显示 name、description 截断、location badge（project/global）
- 点击某行展开/弹出详情面板，显示完整 SKILL.md（使用 `<pre>` 或简单 Markdown 渲染）
- 视觉风格与已有 MCP Tab、收藏 Tab 保持一致（`border-border bg-surface-card` 等）

**Step 3: Wire SkillsTab into the tab content area**

```tsx
{tab === "skills" && <SkillsTab />}
```

**Step 4: Commit**

```bash
git add desktop/src/components/SettingsPanel.tsx
git commit -m "feat(desktop): add Skills tab to settings panel

FR-1: Users can now browse, search, and inspect all available
Skills directly from the Desktop settings UI. Shows project vs
global skills with location badges and full SKILL.md viewer.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

## Phase 2: AGX Bundle 格式定义与解析

> AgenticX 差异化的扩展打包标准

### Task 4: AGX Bundle Manifest 规范

**Files:**

- Create: `agenticx/extensions/bundle.py`
- Create: `agenticx/extensions/__init__.py`

**Step 1: Define the Bundle manifest schema**

`agx-bundle.yaml` 格式规范：

```yaml
# agx-bundle.yaml — AgenticX Extension Bundle Manifest
agx_bundle: "1.0"
name: "deep-research-kit"
version: "1.0.0"
description: "Complete deep research toolkit with crawler, analyzer, and researcher avatar"
author: "Damon Li"
license: "MIT"

components:
  skills:
    - path: skills/research-sop/SKILL.md
      description: "Deep research SOP skill"
    - path: skills/web-crawl/SKILL.md
      description: "Web crawling skill"

  mcp_servers:
    - name: "web-crawler"
      config_path: mcp/web-crawler.json
      description: "MCP server for web crawling"

  avatars:
    - name: "researcher"
      config_path: avatars/researcher.yaml
      description: "Research specialist avatar preset"

  memory_templates:
    - name: "research-workflow"
      path: memory/research-workflow.md
      description: "Memory template for research sessions"
```

**Step 2: Implement `BundleManifest` dataclass and parser**

```python
@dataclass
class BundleManifest:
    name: str
    version: str
    description: str
    author: str
    license: str
    format_version: str  # "1.0"
    skills: list[BundleSkillRef]
    mcp_servers: list[BundleMcpRef]
    avatars: list[BundleAvatarRef]
    memory_templates: list[BundleMemoryRef]
    source_dir: Path

@dataclass
class BundleSkillRef:
    path: str
    description: str

@dataclass
class BundleMcpRef:
    name: str
    config_path: str
    description: str

@dataclass
class BundleAvatarRef:
    name: str
    config_path: str
    description: str

@dataclass
class BundleMemoryRef:
    name: str
    path: str
    description: str
```

**Step 3: Implement `parse_bundle_manifest(dir: Path) -> BundleManifest`**

Defensive parsing with YAML, validates all paths are relative and within bundle dir (no path traversal).

**Step 4: Commit**

```bash
git add agenticx/extensions/
git commit -m "feat(extensions): define AGX Bundle manifest format and parser

FR-4: Introduce agx-bundle.yaml schema supporting four component
types: skills, mcp_servers, avatars, memory_templates. Parser
validates path safety and provides structured BundleManifest.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 5: Bundle Installer

**Files:**

- Modify: `agenticx/extensions/bundle.py` (add install logic)
- Create: `agenticx/extensions/installer.py`

**Step 1: Implement `install_bundle(source: Path, target: Path) -> InstallResult`**

安装逻辑：

1. 解析 `agx-bundle.yaml` manifest
2. 将 skills 复制到 `~/.agenticx/skills/bundles/<bundle-name>/`
3. 将 mcp_servers 配置合并到 `~/.agenticx/mcp.json`
4. 将 avatars 预设复制到 `~/.agenticx/avatars/presets/<bundle-name>/`
5. 将 memory_templates 复制到 `~/.agenticx/workspace/memory_templates/<bundle-name>/`
6. 记录安装信息到 `~/.agenticx/bundles.json`（已安装 Bundle 清单）

**Step 2: Implement `uninstall_bundle(name: str) -> bool`**

反向清理上述目录和 mcp.json 条目。

**Step 3: Implement `list_installed_bundles() -> list[InstalledBundle]`**

从 `~/.agenticx/bundles.json` 读取。

**Step 4: Commit**

```bash
git add agenticx/extensions/
git commit -m "feat(extensions): implement AGX Bundle installer with install/uninstall/list

FR-5: Bundles can be installed from local directories. Skills are
symlinked into scan paths, MCP configs merged, avatar presets and
memory templates placed in standard locations. bundles.json tracks
installed state.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 6: SkillBundleLoader 扩展 — 扫描 Bundle 安装目录

**Files:**

- Modify: `agenticx/tools/skill_bundle.py`

**Step 1: Add bundle skills directory to DEFAULT_SEARCH_PATHS**

在 `DEFAULT_SEARCH_PATHS` 列表中追加：

```python
Path.home() / ".agenticx" / "skills" / "bundles",
```

这样 Bundle 安装的 Skills 会被自动发现。

**Step 2: Commit**

```bash
git add agenticx/tools/skill_bundle.py
git commit -m "feat(skills): add bundle install directory to skill scan paths

SkillBundleLoader now also scans ~/.agenticx/skills/bundles/ so
skills installed via AGX Bundles are automatically discovered.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 7: Studio Bundle API + Desktop「扩展」Tab

**Files:**

- Modify: `agenticx/studio/server.py` (add bundle endpoints)
- Modify: `desktop/electron/main.ts` (IPC for bundles)
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/components/SettingsPanel.tsx` (or create ExtensionsTab)

**Step 1: Add `/api/bundles` endpoints**

```python
@app.get("/api/bundles")
async def list_bundles() -> dict:
    from agenticx.extensions.installer import list_installed_bundles
    bundles = list_installed_bundles()
    return {"ok": True, "items": [b.to_dict() for b in bundles]}

@app.post("/api/bundles/install")
async def install_bundle(payload: dict) -> dict:
    from agenticx.extensions.installer import install_bundle
    source = Path(payload.get("source_path", ""))
    result = install_bundle(source)
    return {"ok": result.success, "bundle": result.name, "error": result.error}

@app.delete("/api/bundles/{name}")
async def uninstall_bundle(name: str) -> dict:
    from agenticx.extensions.installer import uninstall_bundle
    ok = uninstall_bundle(name)
    return {"ok": ok}
```

**Step 2: Desktop Tab — 在「技能」Tab 下方增加「已安装扩展包」section**

或者新增一个「扩展」Tab，展示已安装的 AGX Bundles，每个 Bundle 可展开查看包含的 skills / mcp / avatars / memory_templates 组件。

**Step 3: Commit**

```bash
git add agenticx/studio/server.py desktop/
git commit -m "feat(desktop): add Bundle management API and Extensions section in settings

FR-6: Users can view, install, and uninstall AGX Bundles from
Desktop. Bundles display their component breakdown (skills, MCP
servers, avatar presets, memory templates).

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

## Phase 3: 多源注册表与生态连接

> 连接外部生态，实现发现与安装

### Task 8: 多源注册表配置

**Files:**

- Modify: `agenticx/cli/config_manager.py` (add `extensions.registries` to AgxConfig)
- Create: `agenticx/extensions/registry_hub.py`

**Step 1: 在 config.yaml 中支持多源配置**

```yaml
extensions:
  registries:
    - name: "official"
      url: "https://registry.agxbuilder.com"
      type: "agx"
    - name: "community"
      url: "https://example.com/agx-registry.json"
      type: "agx"
    - name: "clawhub"
      url: "https://clawhub.com/api"
      type: "clawhub"
  scan_dirs:
    - "~/.agenticx/bundles"
    - "~/.agenticx/skills/registry"
```

**Step 2: Implement `RegistryHub` — 聚合多源搜索**

```python
class RegistryHub:
    def search(self, query: str) -> list[SearchResult]:
        """Search across all configured registries."""

    def install(self, source: str, name: str) -> InstallResult:
        """Install from a specific registry source."""
```

**Step 3: Commit**

```bash
git add agenticx/cli/config_manager.py agenticx/extensions/
git commit -m "feat(extensions): implement multi-source registry hub

FR-7: Support official, community, and ClawHub registries via
config.yaml extensions.registries. RegistryHub aggregates search
results across sources.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

### Task 9: Desktop 扩展市场浏览

**Files:**

- Modify: `desktop/src/components/SettingsPanel.tsx` (or new ExtensionMarketplace component)
- Modify: `desktop/electron/main.ts`

**Step 1: 技能 Tab 增加「浏览市场」section**

- 搜索框：跨源搜索
- 结果列表：显示 name、description、author、source badge
- 安装按钮：一键安装到本地

**Step 2: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): add extension marketplace browser in Skills tab

Users can search and install skills/bundles from configured
registries directly within the Desktop settings panel.

Plan-Id: 2026-03-23-extension-ecosystem
Plan-File: .cursor/plans/2026-03-23-extension-ecosystem.plan.md
Made-with: Damon Li"
```

---

## 优先级与里程碑


| Phase            | Tasks    | 预估工作量 | 价值                  |
| ---------------- | -------- | ----- | ------------------- |
| **Phase 1** (P0) | Task 1-3 | 1-2 天 | 补齐已有能力的用户可见性，零新基础设施 |
| **Phase 2** (P1) | Task 4-7 | 3-5 天 | 差异化 Bundle 格式，竞争壁垒  |
| **Phase 3** (P2) | Task 8-9 | 2-3 天 | 生态连接，市场效应           |


**建议实施顺序：Phase 1 → Phase 2 → Phase 3，Phase 1 可以立即开始。**

---

## 关键架构决策

### D1: Bundle vs Plugin 命名

选择 **AGX Bundle** 而非 Plugin。理由：

- Plugin 暗示代码执行/运行时扩展，容易与 MCP 混淆
- Bundle 传达「打包分发」语义，更准确反映其本质（Skills + MCP configs + Avatar presets 的集合）
- 避免与 Cursor Plugin / VS Code Extension 概念冲突

### D2: Skills Tab vs 合并到 MCP Tab

选择 **独立「技能」Tab**。理由：

- Skills（知识层）和 MCP（能力层）在概念上不同
- 用户心智模型：「我要教 AI 怎么做」vs「我要给 AI 连接工具」
- 参考 WorkBuddy 也是 Skills 和 Plugins 分 Tab

### D3: 注册表协议

选择 **HTTP REST + JSON** 而非 npm 协议。理由：

- 与已有 `registry.py` 的 FastAPI 实现一致
- 轻量，易于自建
- 可扩展为 ClawHub 适配层

### D4: Bundle 安装方式

Phase 2 仅支持 **本地目录安装**（`agx bundle install ./path/to/bundle`）。
Phase 3 扩展为从注册表 URL 拉取。
不在 Phase 2 引入 `.tar.gz` 解压以降低复杂度。

---

## 文件变更汇总


| 文件                                         | 动作                                 | Phase |
| ------------------------------------------ | ---------------------------------- | ----- |
| `agenticx/studio/server.py`                | 修改（添加 skills + bundles API）        | 1, 2  |
| `desktop/electron/main.ts`                 | 修改（添加 IPC handlers）                | 1, 2  |
| `desktop/electron/preload.ts`              | 修改（expose IPC）                     | 1, 2  |
| `desktop/src/components/SettingsPanel.tsx` | 修改（添加 Skills Tab + Bundle section） | 1, 2  |
| `desktop/src/global.d.ts`                  | 修改（TypeScript 类型）                  | 1     |
| `agenticx/extensions/__init__.py`          | 创建                                 | 2     |
| `agenticx/extensions/bundle.py`            | 创建（manifest 解析）                    | 2     |
| `agenticx/extensions/installer.py`         | 创建（安装/卸载逻辑）                        | 2     |
| `agenticx/tools/skill_bundle.py`           | 修改（添加 bundle 扫描路径）                 | 2     |
| `agenticx/cli/config_manager.py`           | 修改（扩展配置字段）                         | 3     |
| `agenticx/extensions/registry_hub.py`      | 创建（多源聚合）                           | 3     |


---

## Conclusion



*Implementation pending.*