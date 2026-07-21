# SP4: ToolSearch Runtime Settings + Telemetry

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-tool-search-runtime-settings`  
Parent: `.cursor/plans/2026-07-21-agenticx-tool-search-master.plan.md`  
Depends-on: `2026-07-21-tool-search-core-contract`（配置键名已冻结即可；可不依赖 SP2 代码合并）

## Goal

在 Near Desktop「设置 → Automation / Runtime」暴露 ToolSearch 中文配置，并经现有 `load/save-runtime-config` IPC 写入 `~/.agenticx/config.yaml`；扩展 `CONTEXT_STATS` 遥测字段。默认仍为 `off`。

## Architecture

复用 `RuntimeConfigSection` + `SettingsPanel` 底部统一保存；IPC 严格校验 mode/threshold；后端 `persist_context_stats` / SSE `context_stats` 增加 tool_search 字段（若 SP2 尚未合并，可在本节点先改 payload 组装点并在 SP5 填实数；或本节点只做 Desktop，遥测放到 SP5——**本 plan 要求 Desktop 必做，遥测若 `agent_runtime.py` 冲突则最小补丁只加字段默认 0**）。

## In scope

- `desktop/electron/main.ts`：`load-runtime-config` / `save-runtime-config`（~L8830–8900+）
- `desktop/electron/preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/components/automation/RuntimeConfigSection.tsx`
- `desktop/src/components/SettingsPanel.tsx`（接线 props / save payload）
- `agenticx/runtime/agent_runtime.py`：`context_payload` ~L2532–2546 增加字段（最小）
- 可选：极简前端类型/注释，无新 toast

## Out of scope / no-scope-creep

- 不新增顶部重复「保存」按钮  
- 不改 Skills/MCP/Provider Tab  
- 不改默认 mode 为 `auto`  
- 不新增群聊气泡提示  
- 不做视觉大改

---

## FR / AC

| ID | Requirement | AC |
|----|-------------|-----|
| FR-1 | UI 中文「工具按需加载」：关闭/自动/始终 | 手工或组件测可见三选项 |
| FR-2 | 自动模式可编辑阈值（正整数，建议 clamp 1000–50000，默认 6000） | save 后 yaml 正确 |
| FR-3 | IPC 拒绝非法 mode | save 返回 `{ok:false}` |
| FR-4 | 底部统一保存写入 `runtime.tool_search` | 读回一致 |
| FR-5 | CONTEXT_STATS 含约定字段 | 单测或运行断言 keys |
| FR-6 | `desktop` typecheck + build 绿 | 命令见下 |

---

## Task 1: 类型与 IPC

**Modify:** `desktop/src/global.d.ts` — `RuntimeConfig` 相关类型（约 L92 / L604）

```typescript
tool_search_mode?: "off" | "auto" | "always";
tool_search_auto_schema_token_threshold?: number;
```

**Modify:** `desktop/electron/preload.ts` — `saveRuntimeConfig` payload 类型同步。

**Modify:** `desktop/electron/main.ts`

`load-runtime-config` 返回增加：

```typescript
tool_search_mode: normalizeMode(raw.tool_search),
tool_search_auto_schema_token_threshold: normalizeThreshold(raw.tool_search),
```

其中 yaml：

```yaml
runtime:
  tool_search:
    mode: off
    auto_schema_token_threshold: 6000
```

兼容：若有人误写成扁平 `runtime.tool_search_mode`，可读但不写回扁平（只写嵌套对象）。

`save-runtime-config`：

- `tool_search_mode` ∈ {off,auto,always} 否则 error  
- threshold：`Math.max(1000, Math.min(50000, Math.round(v)))`  
- 写入 `merged.tool_search = { mode, auto_schema_token_threshold }`  
- 不删除其他 `runtime.*` 键

---

## Task 2: RuntimeConfigSection UI

**Modify:** `desktop/src/components/automation/RuntimeConfigSection.tsx`

扩展 props：

```typescript
toolSearchMode: "off" | "auto" | "always";
onToolSearchModeChange: (v: "off" | "auto" | "always") => void;
toolSearchThreshold: number;
onToolSearchThresholdChange: (v: number) => void;
```

UI 区块（中文）：

- 标题：工具按需加载  
- 说明：首轮只提供核心工具，需要时通过检索加载更多工具定义，可减少上下文占用。关闭时与旧版行为一致。  
- 选择器：关闭 / 自动（超过阈值启用）/ 始终  
- 仅当「自动」时显示阈值输入或 range  
- **不要**在本卡片内放保存按钮

视觉：沿用现有 `rounded-lg border border-border bg-surface-panel` 卡片样式，与「最大工具轮数」一致。

---

## Task 3: SettingsPanel 接线

**Modify:** `desktop/src/components/SettingsPanel.tsx`

- load 时（~L2280 附近 `loadRuntimeConfig`）读入 mode/threshold state  
- 传给 `<RuntimeConfigSection ... />`（~L2508）  
- 底部保存（~L2418 `saveRuntimeConfig`）附带新字段  

禁止另造保存入口。

---

## Task 4: CONTEXT_STATS 字段

**Modify:** `agenticx/runtime/agent_runtime.py` ~L2532 `context_payload`

增加（缺省用 0 / `"off"` / `false`，SP2/SP5 填实）：

```python
"tool_search_mode": <str>,
"tool_search_applied": <bool>,
"tool_search_candidate_count": <int>,
"tool_search_loaded_count": <int>,
"tool_search_schema_tokens_before": <int>,
"tool_search_schema_tokens_sent": <int>,
"tool_search_schema_tokens_saved": <int>,
```

前端 `ChatPane.tsx` ~L9576 `context_stats`：若仅展示部分字段，本节点**可不**改 UI；字段进 jsonl / SSE 即可。禁止新增刷屏 toast。

若 SP2 未合并导致拿不到 ctx：仍 emit 默认值，避免 SSE 形状不稳定。

---

## Task 5: 验证

```bash
cd desktop && npm run typecheck && npm run build
```

手工验收清单：

1. 设置 → Runtime：看到「工具按需加载」  
2. 选「始终」，底部保存，打开 `~/.agenticx/config.yaml` 见 `runtime.tool_search.mode: always`  
3. 选非法值无法经 IPC 写入（可用临时脚本调 invoke）  
4. 改回 `off` 保存成功  

---

## Commit 边界

允许上述 Desktop 文件 + `agent_runtime.py` 遥测字段 + 本 plan。  
禁止改工具投影/MCP hub。
