# Plan: Desktop 记忆预算路由设置 UI（BudgetMem 配置可视化）

Plan-Id: 2026-06-14-desktop-memory-budget-settings-ui
Status: draft (待用户确认后执行)
Owner: Damon Li
实施模型预期: composer-2.5（已按"精确到文件/函数/锚点 + 复刻现成范本"编写）
关联/依赖:
- 是 `2026-06-14-budgetmem-query-aware-memory-routing` 的 §8 P2-C 拆分独立 plan。
- **依赖后端配置契约**：`memory.budget` 节定义见 BudgetMem plan FR-1.1。本 plan 只做
  「读写该 config 节的 Desktop GUI」，不实现也不依赖后端路由逻辑是否已接线——
  GUI 写入的 `config.yaml` 会在后端 plan 落地后自动生效。

---

## 0. 给实施者（composer）的阅读须知

- 本功能是「把一个 `~/.agenticx/config.yaml` 记忆配置节做成设置面板」，项目里**已有
  一模一样的现成范本**：对话轮次记忆（`turn_archive`）。**严格 1:1 复刻它的四件套**，
  不要另起架构。范本文件见 §2。
- 严守 `no-scope-creep`：只新增 budget 面板相关代码 + 在设置页挂载；不改 TurnArchive、
  不改后端路由逻辑、不动其它设置项。
- **不新增后端 config 字段**：面板字段严格对齐 BudgetMem plan FR-1.1 已定义的
  `memory.budget` 结构（enabled / default_tier / router / refine.* / tiers.*）。
- TS/React 遵守既有组件风格（语义 token、`MiniSwitch`、`Panel` 折叠）；文案中文化，
  对齐设置页其它区块；不暴露内部实现细节（不在 UI 写阈值/关键词等）。
- **改 Electron 主进程（main.ts / preload.ts）后必须完全重启 `npm run dev`**，
  仅刷新渲染进程不会加载新 IPC handler（项目既有教训）。

---

## 1. 背景与设计取舍（执行前必读）

### 1.1 暴露哪些 / 不暴露哪些（已与用户确认的分层原则）
**暴露**（有副作用、值得用户控制）：
- 智能预算路由总开关（`memory.budget.enabled`）。
- 默认档位 `default_tier`（路由关闭时使用的固定档）。
- HIGH 档结构化精炼开关（`refine.enabled`，会增首字延迟 + 一次 LLM 成本）。
- 精炼模型 `refine.model`（留空回退主会话模型，建议填小模型省钱）。
- 高级（默认折叠）：`refine.max_input_chars` 与各 tier 的 `limit/include_graph/
  include_turns/turns_limit`。

**不暴露**（内部调优噪音，留在后端代码常量里）：
- 启发式分类器的阈值数字、关键词表。UI 一律不出现。

### 1.2 用户"有感知"的最轻量方式（非本 plan 强制，提示后端 plan 已含）
HIGH 档精炼命中时，注入段标题显示「已按当前问题深度整理」（由 BudgetMem plan FR-5.1
负责），用户自然感知。本 plan 只负责设置面板。

### 1.3 router 字段处理
`router` 目前后端仅支持 `"heuristic"`（`"learned"` 未实现，见 BudgetMem plan P2-B）。
本面板**只读展示**当前为「启发式（heuristic）」，不提供可切换下拉（避免选了不可用项）。

---

## 2. 复刻范本（四件套，逐一对照改）

对话轮次记忆（`turn_archive`）的完整实现链路，**budget 面板按同样结构新增**：

| 层 | TurnArchive 范本（参考，勿改） | Budget 新增 |
|---|---|---|
| 主进程类型/默认/读取/校验/IPC | `desktop/electron/main.ts`：`TurnArchiveConfig`(L296)、`DEFAULT_TURN_ARCHIVE_CONFIG`(L473)、`loadTurnArchiveConfig`(L1453)、`validateTurnArchiveConfigPayload`(L1489)、`ipcMain.handle("load/save-turn-archive-config")`(L4793/L4798) | 新增 `BudgetConfig` 类型、`DEFAULT_BUDGET_CONFIG`、`loadBudgetConfig`、`validateBudgetConfigPayload`、`ipcMain.handle("load/save-memory-budget-config")`；save 时合并到 `root.memory.budget`（仿 L4809） |
| preload 暴露 | `desktop/electron/preload.ts`：`loadTurnArchiveConfig`/`saveTurnArchiveConfig`(L388-389) | 新增 `loadMemoryBudgetConfig`/`saveMemoryBudgetConfig` |
| 渲染端类型声明 | `desktop/src/global.d.ts`（TurnArchive 条目） | 新增 budget 两个方法的类型声明 |
| 面板组件 | `desktop/src/components/memory/TurnArchiveSettingsPanel.tsx` | 新增 `desktop/src/components/memory/BudgetSettingsPanel.tsx` |
| 挂载点 | `desktop/src/components/SettingsPanel.tsx`（已挂 `<TurnArchiveSettingsPanel/>`） | 同区域挂 `<BudgetSettingsPanel/>` |

---

## 3. 范围（Scope）与非目标

### In scope
- 上表 budget 四件套 + 挂载。读写 `~/.agenticx/config.yaml` 的 `memory.budget`。

### Out of scope
- 不实现/不改后端路由、Router、Refiner（属 BudgetMem 后端 plan）。
- 不改 TurnArchive / 知识库 / 其它设置区。
- 不做精炼模型的"测试连通性"（模型选择若用既有选择器则自然带；最小实现用文本框）。
- 不改 enterprise/。

---

## 4. 需求（FR / NFR / AC）

### FR-1 主进程读写（main.ts）
- FR-1.1 新增 `BudgetConfig` TS 类型，字段与 `memory.budget` 对齐：
  ```ts
  type BudgetTierParams = {
    limit: number; include_graph: boolean; include_turns: boolean; turns_limit: number;
  };
  type BudgetConfig = {
    enabled: boolean;
    default_tier: "low" | "mid" | "high";
    router: "heuristic";
    refine: { enabled: boolean; model: string; max_input_chars: number };
    tiers: { low: BudgetTierParams; mid: BudgetTierParams; high: BudgetTierParams };
  };
  ```
- FR-1.2 `DEFAULT_BUDGET_CONFIG` 与 BudgetMem plan FR-1.1 的默认值**逐字一致**
  （enabled=false / default_tier="mid" / router="heuristic" / refine.enabled=false /
  refine.model="" / refine.max_input_chars=4000 / tiers 三档默认值）。
- FR-1.3 `loadBudgetConfig(cfg)`：从 `cfg.memory.budget` 安全解析，缺节/缺字段/坏值
  逐字段回退默认（仿 `loadTurnArchiveConfig` 的防御写法）。
- FR-1.4 `validateBudgetConfigPayload(input)`：校验类型与枚举（tier 取值、数值范围、
  布尔），非法返回 `{ok:false,error}`；合法返回规整后的 `BudgetConfig`。
- FR-1.5 IPC：`ipcMain.handle("load-memory-budget-config")` 返回
  `{ok:true,config}`；`ipcMain.handle("save-memory-budget-config", payload)` 校验后
  合并 `root.memory.budget`（保留 `root.memory` 其它子节如 `turn_archive`，仿 L4805-4810）
  并 `saveAgxConfig`。

### FR-2 preload + 类型声明
- FR-2.1 `preload.ts` 暴露：
  `loadMemoryBudgetConfig: () => ipcRenderer.invoke("load-memory-budget-config")`、
  `saveMemoryBudgetConfig: (payload) => ipcRenderer.invoke("save-memory-budget-config", payload)`。
- FR-2.2 `global.d.ts` 增加这两个方法的类型声明（入参用 FR-1.1 的 `BudgetConfig`，
  返回 `{ok:boolean; config?:BudgetConfig; error?:string}`）。

### FR-3 BudgetSettingsPanel.tsx（UI）
- FR-3.1 结构复刻 `TurnArchiveSettingsPanel`：`Panel title="记忆预算路由" collapsible
  defaultCollapsed`，load/save 用 `window.agenticxDesktop.loadMemoryBudgetConfig/save...`，
  乐观更新 + 失败回滚 + 末尾保存状态文案（仿其 `save`/`message` 逻辑）。
- FR-3.2 控件（顶部主区）：
  1. 总开关「启用智能预算路由」→ `enabled`（hint：默认关闭；关闭时所有 query 走
     默认档，行为同现状）。
  2. 「默认档位」select：低 / 均衡 / 高 → `default_tier`（hint：路由关闭时使用）。
  3. 开关「复杂问题深度整理（HIGH 档）」→ `refine.enabled`
     （hint：开启后复杂问题会多一次模型调用，更慢但记忆更精炼；默认关闭）。
  4. 「整理使用的模型」文本输入 → `refine.model`
     （hint：留空则用当前会话模型；建议填一个小模型以省成本）。仅 `refine.enabled`
     时可编辑。
- FR-3.3 高级参数（`Panel "高级参数" collapsible defaultCollapsed`，仿范本）：
  - `refine.max_input_chars`（number，500–20000）。
  - 三档 tier 的 `limit`（1–20）/ `include_graph`（switch）/ `include_turns`（switch）/
    `turns_limit`（0–10）。以「低 / 均衡 / 高」分组，紧凑布局。
- FR-3.4 文案与样式：复用范本的 `MiniSwitch`、字段基础类、`TaField` 同款（可直接
  复制到本组件或抽公共件——最小实现允许在本组件内复制，避免牵动范本文件）。
  顶部说明一句：写入 `~/.agenticx/config.yaml` 的 `memory.budget`，与对话轮次记忆、
  记忆图谱并行；并标注「路由开关 / 深度整理需新开对话后生效」。
- FR-3.5 `router` 不提供可改控件，仅在说明区注明「当前路由：启发式」。

### FR-4 挂载
- FR-4.1 在 `SettingsPanel.tsx` 中 TurnArchive 同一记忆设置区域挂载
  `<BudgetSettingsPanel/>`（紧邻对话轮次记忆，保持记忆类设置聚拢）。

### NFR
- NFR-1 不改后端 Python；不改 TurnArchive 等既有设置。
- NFR-2 缺 `memory.budget` 节时面板显示全默认且可正常保存（生成该节）。
- NFR-3 保存只合并 `memory.budget`，不得覆盖 `memory` 下其它子节。
- NFR-4 `npm run typecheck` 与 `npm run build`（或既有等价）通过。

### AC（验收）
- AC-1 设置页出现「记忆预算路由」可折叠面板；默认折叠、字段为默认值。
- AC-2 改总开关/默认档/精炼开关/精炼模型并保存 → 写入 `config.yaml` 的
  `memory.budget`，重开设置页回显一致（手工 + 读 yaml 验证）。
- AC-3 保存 budget 不破坏同文件 `memory.turn_archive` 等既有节（手工验证 yaml）。
- AC-4 非法 payload（如 default_tier 乱值）被 `validateBudgetConfigPayload` 拒绝，
  面板回滚并提示。
- AC-5 `npm run typecheck` 绿。

---

## 5. 实施步骤（分阶段）

### Phase 0 — 主进程配置读写（main.ts）
1. 加 `BudgetConfig` 类型、`DEFAULT_BUDGET_CONFIG`、`loadBudgetConfig`、
   `validateBudgetConfigPayload`、两个 `ipcMain.handle`（FR-1，紧邻 TurnArchive 实现）。
2. 自测：临时打印或单测校验函数（无前端也能验 load/validate）。

### Phase 1 — preload + 类型声明
3. `preload.ts` 暴露两方法（FR-2.1）；`global.d.ts` 加类型（FR-2.2）。

### Phase 2 — 面板组件
4. 新增 `desktop/src/components/memory/BudgetSettingsPanel.tsx`（FR-3，复刻范本）。

### Phase 3 — 挂载 + 校验
5. `SettingsPanel.tsx` 挂载（FR-4）。
6. `npm run typecheck`（AC-5）；**完全重启 `npm run dev`**（主进程改动）。
7. 手工回归 AC-1~AC-4：改值保存→读 `~/.agenticx/config.yaml` 验证 `memory.budget`
   写入且 `turn_archive` 未被破坏。

### Phase 4 — 提交
8. `/commit --spec=.cursor/plans/2026-06-14-desktop-memory-budget-settings-ui.plan.md`：
   - `feat(desktop): memory.budget 配置读写 IPC`
   - `feat(desktop): 记忆预算路由设置面板`
   含 `Made-with: Damon Li` + Plan-Id/Plan-File trailer。

---

## 6. 关键文件索引（执行参考）
改动：
- `desktop/electron/main.ts`（budget 类型/默认/load/validate/IPC，仿 turn_archive）
- `desktop/electron/preload.ts`（暴露两方法）
- `desktop/src/global.d.ts`（类型声明）
- `desktop/src/components/SettingsPanel.tsx`（挂载）
新增：
- `desktop/src/components/memory/BudgetSettingsPanel.tsx`
范本（只读对照，勿改）：
- `desktop/src/components/memory/TurnArchiveSettingsPanel.tsx`
- `main.ts` 的 `TurnArchiveConfig` / `loadTurnArchiveConfig` /
  `validateTurnArchiveConfigPayload` / `load|save-turn-archive-config` handler

---

## 7. 风险与回退
- 风险：改主进程未重启导致 IPC 不生效（表现为"保存没反应"）→ 必须完全重启
  `npm run dev`（已在须知强调）。
- 风险：保存覆盖 `memory` 其它子节 → 用合并写法（NFR-3 + AC-3 守护）。
- 风险：后端尚未接线 `memory.budget` → 面板仍可正常存配置，后端 plan 落地即生效；
  二者解耦无阻塞。
- 回退：纯新增 + 一处挂载，单独 revert 即可；不影响其它设置。
