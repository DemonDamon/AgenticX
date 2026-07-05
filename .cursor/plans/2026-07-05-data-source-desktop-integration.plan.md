# Sub-Plan C：Desktop 集成（设置页「数据源」Tab + 凭证 GUI + config.yaml 安全写入）

Planned-with: Claude Sonnet 5
Plan-Id: 2026-07-05-data-source-desktop-integration
Plan-File: .cursor/plans/2026-07-05-data-source-desktop-integration.plan.md
父规划: `.cursor/plans/2026-07-05-unified-data-source-gateway.plan.md`
前置依赖: Sub-Plan A（`data_sources:` config schema 与 registry 已定义）；可与 Sub-Plan B 并行开发

## 1. 需求

### FR

- **FR-1**：新增 `/api/data-sources/config`（GET/PUT）与 `/api/data-sources/status`（GET）后端端点，遵循仓库既有 `/api/kb/config` 的模式（`ConfigManager` 读写 `~/.agenticx/config.yaml` 的 `data_sources:` 节，而非允许 Agent 或前端直接写文件）。
- **FR-2**：Desktop 设置面板新增「数据源」Tab（`SettingsPanel.tsx` 的 `TABS` 数组 + `SettingsTab` 类型），供用户：
  - 查看已发现的数据源插件列表（分组展示：免费/无需配置 vs 需要凭证）。
  - 对需要凭证的插件（`tushare`/`ifind`）填写 Token/账号并测试连通性（复用现有「测试连通性」按钮范式，见 AGENTS.md 记忆中「同一鉴权项不要并列暴露 API Key + 环境变量名两个输入框，保留单一输入框 + 测试连通性按钮」的既定偏好）。
  - 一键启用/停用某个数据源插件（写 `data_sources.<name>.enabled`）。
- **FR-3**：`/api/tools/registry` 返回的工具列表中，`list_data_sources`/`query_data_source` 归类到新分类 `data_source`，Desktop「工具」Tab 需能正确展示该分类（复用现有分组渲染逻辑，不需要新增前端分组 UI 框架）。
- **FR-4**：数据源状态（已启用/未启用/凭证缺失/连接失败）需要有明确的状态点展示，对齐 AGENTS.md 记忆中「模型供应商侧栏状态点仅保留红/绿两态」的既有产品语义（绿=已启用且凭证齐全或无需凭证；红=未启用或凭证缺失/测试失败）。
- **FR-5**：`tushare` 插件依赖已连接的 `tushareMcp`（见 Sub-Plan B FR-4），因此「数据源」Tab 中 `tushare` 卡片需展示「依赖 MCP: tushareMcp（未连接）」并提供跳转到 MCP 设置 Tab 的快捷入口，而不是重复实现一套凭证输入框。

### NFR

- **NFR-1**：所有配置写入必须走 `ConfigManager` 专用方法（或新端点内部调用），**不得**让 Agent 侧 `file_write`/`file_edit` 工具绕过既有对 `~/.agenticx/config.yaml` 的直改拦截。
- **NFR-2**：凭证输入框在 UI 层不回显明文（复用现有 API Key 输入框的掩码展示范式）。
- **NFR-3**：Tab 加载时若 registry 尚未初始化（如后端刚启动），前端需展示 loading 态而非报错空白。

### AC

- **AC-1**：在「数据源」Tab 打开 `akshare` 卡片，因其 `requires_credential=False`，卡片直接显示绿色「已启用」，无凭证输入框。
- **AC-2**：打开 `ifind` 卡片，显示「需企业授权，暂不可配置」的说明文案与 8 个 API 目录（只读展示，不允许假装可填凭证却无实际使用价值）。
- **AC-3**：切换 `tushare` 的启用开关后，重启（或热重载）registry，`query_data_source(data_source_name="tushare", ...)` 行为随开关状态变化。
- **AC-4**：所有改动（启停/凭证保存）有即时 toast 反馈；保存失败保留弹窗并透出后端错误详情（对齐 AGENTS.md「保存失败须保留弹窗透出底层错误」的既定偏好）。

## 2. 技术方案

### 2.1 后端端点

**Files:**
- Create: `agenticx/studio/data_sources_routes.py`（新文件，仿照 `agenticx/studio/kb/routes.py` 的 `attach_routes(app)` 模式）
- Modify: `agenticx/studio/server.py`（在 `create_studio_app()` 中调用 `attach_data_sources_routes(app)`；在 `_TOOL_CATEGORIES` 加入 `data_source` 分类，已在 Sub-Plan A 完成）

```python
#!/usr/bin/env python3
"""HTTP routes for the data source gateway settings (Desktop "数据源" tab).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import FastAPI, Header, HTTPException

from agenticx.studio.session_manager import ConfigManager


def attach_data_sources_routes(app: FastAPI, check_token) -> None:
    """Attach /api/data-sources/* routes to the given FastAPI app.

    `check_token` is the existing Desktop token guard callable already used
    by other Studio routes (reuse, do not reimplement auth).
    """

    @app.get("/api/data-sources/config")
    async def get_data_sources_config(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Dict[str, Any]:
        check_token(x_agx_desktop_token)
        global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
        return {"data_sources": global_data.get("data_sources", {})}

    @app.put("/api/data-sources/config")
    async def put_data_sources_config(
        payload: Dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Dict[str, Any]:
        check_token(x_agx_desktop_token)
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="missing 'name'")
        patch = payload.get("patch") or {}
        # NOTE: implementer must add ConfigManager.update_section() (or equivalent
        # safe-merge write helper) if it doesn't already exist -- do NOT open the
        # yaml file directly here; search for the existing safe-write helper used
        # by e.g. the knowledge_base or skills settings PUT handlers and mirror it.
        ConfigManager.update_section("data_sources", name, patch)
        return {"ok": True}

    @app.get("/api/data-sources/status")
    async def get_data_sources_status(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Dict[str, Any]:
        check_token(x_agx_desktop_token)
        from agenticx.cli.agent_tools import _get_data_source_registry

        registry = _get_data_source_registry()
        items = []
        for plugin in registry.list_plugins():
            items.append({
                "name": plugin.name,
                "display_name": plugin.display_name,
                "domain": plugin.domain,
                "requires_credential": plugin.requires_credential,
                "status": "ready",  # implementer: derive real status incl. "missing_credential"/"mcp_disconnected"
            })
        return {"data_sources": items}

    @app.post("/api/data-sources/test")
    async def test_data_source(
        payload: Dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Dict[str, Any]:
        check_token(x_agx_desktop_token)
        from agenticx.cli.agent_tools import _get_data_source_registry

        name = str(payload.get("name") or "").strip()
        registry = _get_data_source_registry()
        plugin = registry.get(name)
        if plugin is None:
            raise HTTPException(status_code=404, detail=f"unknown data source '{name}'")
        apis = plugin.list_apis()
        if not apis:
            return {"ok": False, "detail": "plugin exposes no apis"}
        try:
            await registry.call(name, apis[0].name, apis[0].example_params or {})
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "detail": str(exc)}
```

> **实施者注意**：`ConfigManager.update_section` 是本规划假设需要的安全写入辅助方法。实施第一步必须先 `Grep "def update_section\|def save_yaml\|def write_section"` 确认 `ConfigManager` 是否已有等价方法（例如 skills 设置的 `PUT /api/skills/settings` 大概率已实现了类似的安全合并写入），若已有则直接复用其签名，不要重复发明。

### 2.2 前端：新增「数据源」Tab

**Files:**
- Create: `desktop/src/components/settings/datasources/DataSourcesSettings.tsx`
- Create: `desktop/src/components/settings/datasources/DataSourceCard.tsx`
- Create: `desktop/src/components/settings/datasources/api.ts`
- Create: `desktop/src/components/settings/datasources/types.ts`
- Modify: `desktop/src/settings-tab.ts`（`SettingsTab` 联合类型新增 `"data_sources"`）
- Modify: `desktop/src/components/SettingsPanel.tsx`（`TABS` 数组新增条目；渲染分支新增 `{tab === "data_sources" && <DataSourcesSettings />}`）

`types.ts`：

```typescript
export type DataSourceStatus = "ready" | "missing_credential" | "mcp_disconnected" | "disabled";

export interface DataSourceInfo {
  name: string;
  displayName: string;
  domain: string;
  requiresCredential: boolean;
  status: DataSourceStatus;
  enabled: boolean;
}
```

`DataSourcesSettings.tsx`（骨架）：

```tsx
import { useEffect, useState } from "react";
import { fetchDataSourcesStatus, testDataSource, updateDataSourceConfig } from "./api";
import { DataSourceCard } from "./DataSourceCard";
import type { DataSourceInfo } from "./types";

export function DataSourcesSettings() {
  const [items, setItems] = useState<DataSourceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDataSourcesStatus()
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return <div className="p-4 text-sm text-rose-400">加载数据源失败：{error}</div>;
  }
  if (!items) {
    return <div className="p-4 text-sm text-text-muted">正在加载数据源…</div>;
  }

  const free = items.filter((i) => !i.requiresCredential);
  const credentialed = items.filter((i) => i.requiresCredential);

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="text-sm font-medium text-text-strong">开箱即用（免费/无需凭证）</h3>
        <div className="mt-2 space-y-2">
          {free.map((item) => (
            <DataSourceCard key={item.name} item={item} onToggle={updateDataSourceConfig} />
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-medium text-text-strong">需要凭证 / 依赖 MCP</h3>
        <div className="mt-2 space-y-2">
          {credentialed.map((item) => (
            <DataSourceCard
              key={item.name}
              item={item}
              onToggle={updateDataSourceConfig}
              onTest={testDataSource}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

`DataSourceCard.tsx` 需要遵守 AGENTS.md 里对状态点、保存反馈的既定视觉语义（红/绿两态状态点，保存 toast，测试连通性按钮），实施时直接复用 `settings/knowledge/` 或模型供应商列表卡片中已有的状态点组件与按钮样式，不新造一套视觉规范。

### 2.3 工具注册表展示（复用现有分组渲染）

`/api/tools/registry` 已在 Sub-Plan A 加入 `data_source` 分类；Desktop 「工具」Tab（`SettingsPanel.tsx` 中渲染 `/api/tools/registry` 结果的现有组件）无需新增分组 UI 框架，仅需确认分类中文标签映射表（若存在如 `_CATEGORY_LABELS` 之类的前端映射）补充 `data_source: "数据源"` 条目。

## 3. 验收标准与用例

### 后端契约测试（新增 `tests/test_smoke_data_sources_routes.py`）

```python
"""Smoke tests for the /api/data-sources/* HTTP routes.

Author: Damon Li
"""

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def test_get_data_sources_config_returns_empty_section_by_default():
    app = create_studio_app()
    client = TestClient(app)
    resp = client.get("/api/data-sources/config")
    assert resp.status_code in (200, 401)  # 401 if desktop token enforced in this environment


def test_unknown_data_source_test_returns_404():
    app = create_studio_app()
    client = TestClient(app)
    resp = client.post("/api/data-sources/test", json={"name": "does-not-exist"})
    assert resp.status_code in (404, 401)
```

> 实施者需按仓库现有测试对 `x-agx-desktop-token` 的处理惯例（本机测试通常有一个测试 token 或禁用校验的 fixture）调整断言，上面 `in (200, 401)` 只是占位，落地时应收紧为确定值。

### 人工用例

| 用例 | 步骤 | 预期 |
|---|---|---|
| UC-1 | 打开设置 → 数据源 | 看到 akshare/world_bank 绿色已启用，tushare/ifind 红色需配置 |
| UC-2 | 点击 tushare 卡片「去 MCP 设置连接」 | 跳转到 MCP Tab 并聚焦 `tushareMcp` 条目 |
| UC-3 | 停用 akshare 后回到聊天问股价 | Agent 通过 `list_data_sources` 感知到 akshare 已停用，不再调用 |

## 4. 风险与资源排期

| 风险 | 影响 | 缓解 |
|---|---|---|
| `ConfigManager` 无现成的安全分段写入方法 | FR-1 需要新增基础设施而非纯业务代码 | 实施前先排查 skills/knowledge_base 的 PUT 端点实现，抽取共用写入辅助函数，避免为每个新设置面板各写一套 |
| registry 是全局单例，配置变更后不会自动热重载 | UC-3 可能要求重启才生效，体验打折 | 在 PUT 端点保存成功后主动重置 `agenticx.cli.agent_tools._DATA_SOURCE_REGISTRY = None`，下次调用惰性重建 |
| 前端分类中文标签映射位置未定位 | FR-3 可能漏改一处映射导致英文分类名裸露 | 实施时先 `Grep "_CATEGORY_LABELS\|categoryLabel"` 定位所有需要同步修改的位置 |

**预估工作量**：2 人天（后端端点 0.7 天 + 前端 Tab/卡片 1 天 + 联调 0.3 天）。
**前置条件**：Sub-Plan A 完成；可与 Sub-Plan B 并行（不依赖具体插件实现细节，只依赖 `DataSourcePlugin` 接口形状）。
**产出物**：`agenticx/studio/data_sources_routes.py`、`desktop/src/components/settings/datasources/*`、`tests/test_smoke_data_sources_routes.py`。
