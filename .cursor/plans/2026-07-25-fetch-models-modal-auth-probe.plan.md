# 获取模型列表弹窗：自动探测未授权并禁用添加

Planned-with: claude-sonnet-5-thinking  
Suggested-Impl-Model: composer-2.5

> **For implementers:** 本 plan 须可被 Composer 2.5 在无对话上下文下独立高质量落地。

## Goal

`SettingsPanel.tsx` 的「获取模型列表」弹窗（`fetchModelsModalOpen`）当前只展示「当前状态：可见/不可见」，用户须手动到主列表点「批量健康检查」才能发现某模型未授权（如 MOMA 网关目录含 `Kimi/Kimi-K2.6` 但 Key 无权限，调用即 401 `Model Auth check`）。需求：弹窗打开后**自动**对尚未可见（不可见）的候选模型做鉴权探测，未授权的行需用醒目标签标注「未授权」，且「+」（设为可见）按钮须置灰不可点击。

## Root cause / evidence

见 `.cursor/plans/2026-07-25-model-health-unauthorized-badge.plan.md`（已实现主列表「未授权」标签，但仅覆盖 `current.models` 中已可见的模型，且需用户手动点「批量健康检查」触发）。本 plan 补齐「获取模型列表」弹窗内**尚未添加**的候选模型的自动探测，复用同一套 `classifyModelHealthFailure` / `modelHealthMap` 基础设施。

## Architecture

1. 复用现有 `modelHealthMap`（key: `${provider}:${model}`，phase 含 `unauthorized`）作为唯一真源，弹窗与主列表共享同一状态，避免重复探测、避免状态不一致。
2. `onFetchModels` 成功后，对 `normalized` 列表中**当前不可见**（`!current.models.includes(model)`）且 `modelHealthMap` 尚无记录的模型，发起**串行**后台探测队列（复用 `window.agenticxDesktop.healthCheckModel` IPC，与现有 `onBatchHealthCheck` 相同调用方式）。
3. 用一个自增的 generation ref 做取消：关闭弹窗或切换厂商时递增 generation，探测循环发现 generation 过期则停止写入状态（避免脏更新，也避免继续消耗探测请求配额）。
4. 弹窗内展示探测进度文案（如「自动检测中 12/55」），避免用户以为卡住。
5. 行内 UI：`unauthorized` → 醒目 amber 徽标「未授权」（图标 + 文字，非纯灰字），HoverTip 显示错误摘要；`checking` → 「检测中…」；其余不变。「+」按钮 `disabled` 条件追加 `|| unauthorized`。

## In scope

- FR-1: 弹窗打开后自动对**不可见候选模型**做鉴权探测（串行，逐个更新，不阻塞 UI）。
- FR-2: 已在 `modelHealthMap` 中有记录（无论哪个 phase）的模型跳过重复探测。
- FR-3: `unauthorized` 行的状态区用醒目徽标（图标+文字，amber 底色）替代普通灰字，并保留 HoverTip 错误摘要。
- FR-4: `unauthorized` 行的「+」按钮 disabled，无法点击添加为可见。
- FR-5: 关闭弹窗 / 切换厂商 → 取消后续探测（generation 机制），不产生脏状态更新。
- FR-6: 弹窗内展示探测进度提示文案。

## Out of scope

- 已可见模型（`current.models` 内）的探测逻辑不变（仍走主列表已有的手动「检测」/「批量健康检查」）。
- 不改变「从 API 获取模型」拉取目录的行为（仍全量返回，不做服务端/IPC 层过滤）。
- 不修改聊天模型选择器（`ChatPane`/`ChatView`/`model-options.ts`）对未授权模型的可选性。
- 不做并发探测（保持与现有 `onBatchHealthCheck` 一致的串行节奏，避免打爆网关 QPS）。
- 不持久化探测结果到 `config.yaml` / localStorage（沿用现有 `modelHealthMap` 仅存于组件内存 state 的既有约定）。

## Task 1: 探测队列 + 取消机制 + 自动触发

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`

**锚点 1 — 新增 generation ref 与进度 state（紧邻 `fetchModelsRequestSeqRef` 定义处，约 L6253 附近）：**

```ts
const authProbeGenerationRef = useRef(0);
const [authProbeProgress, setAuthProbeProgress] = useState<{ done: number; total: number } | null>(null);
```

**锚点 2 — 新增探测队列函数（放在 `onBatchHealthCheck` 定义之后即可）：**

```ts
const runAuthProbeQueue = useCallback(
  async (provider: string, models: string[], apiKey: string, baseUrl: string | undefined) => {
    const generation = ++authProbeGenerationRef.current;
    const pending = models.filter((m) => !modelHealthMap[`${provider}:${m}`]);
    if (pending.length === 0) {
      setAuthProbeProgress(null);
      return;
    }
    setAuthProbeProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i += 1) {
      if (authProbeGenerationRef.current !== generation) return;
      const model = pending[i];
      const key = `${provider}:${model}`;
      setModelHealthMap((p) => (p[key] ? p : { ...p, [key]: { phase: "checking" } }));
      // eslint-disable-next-line no-await-in-loop
      const res = await window.agenticxDesktop.healthCheckModel({ provider, apiKey, baseUrl, model });
      if (authProbeGenerationRef.current !== generation) return;
      setModelHealthMap((p) => ({ ...p, [key]: healthEntryFromCheckResult(res) }));
      setAuthProbeProgress({ done: i + 1, total: pending.length });
    }
    if (authProbeGenerationRef.current === generation) setAuthProbeProgress(null);
  },
  [modelHealthMap],
);
```

注意：`modelHealthMap` 作为闭包依赖仅用于**首次快照**判断哪些模型已探测过；循环内部靠 `setModelHealthMap` 的函数式更新读取最新状态写入，不依赖闭包里的旧值做写入判断（避免 stale closure 导致重复探测同一批但不会导致数据错误，可接受）。

**锚点 3 — 在 `onFetchModels` 成功分支触发（约 L7114 `setFetchModelsModalOpen(true);` 之后）：**

```ts
setFetchedModels(normalized);
setFetchModelsSearch("");
setFetchModelsModalOpen(true);
const candidates = normalized.filter((m) => !current.models.includes(m));
if (candidates.length > 0) {
  void runAuthProbeQueue(requestProvider, candidates, requestApiKey, requestBaseUrl);
}
```

**锚点 4 — 关闭弹窗时取消探测（`closeFetchModelsModal`，约 L7134）：**

```ts
const closeFetchModelsModal = () => {
  authProbeGenerationRef.current += 1;
  setAuthProbeProgress(null);
  setFetchModelsModalOpen(false);
  setFetchModelsSearch("");
};
```

**锚点 5 — 切换厂商时同样取消（现有 `useEffect(() => { ...; }, [active])`，约 L6995–7003，追加一行）：**

```ts
useEffect(() => {
  setFetchModelsModalOpen(false);
  setFetchedModels([]);
  setFetchModelsSearch("");
  setFetchModelsError(null);
  setFetchingModels(false);
  authProbeGenerationRef.current += 1;
  setAuthProbeProgress(null);
  activeProviderRef.current = active;
  fetchModelsRequestSeqRef.current += 1;
}, [active]);
```

**AC-1:** 打开 MOMA 厂商「获取模型列表」，观察到未可见模型逐个从「检测中」变为最终态；关闭弹窗后网络面板确认不再有新的 `/chat/completions` 探测请求发出。

---

## Task 2: 弹窗行 UI — 醒目「未授权」标签 + 禁用「+」

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`

**锚点 — import 追加图标（约 L17–48 的 lucide-react import 块）：**

```ts
import {
  // ...existing...
  TriangleAlert,
} from "lucide-react";
```

**锚点 — 弹窗行渲染（约 L9032–9076，`filteredFetchedModels.map` 内）：**

Before:
```tsx
filteredFetchedModels.map((model) => {
  const isVisible = current.models.includes(model);
  return (
    <div key={model} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border bg-surface-panel/60 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-text-muted">{model}</div>
        <div className="text-[11px] text-text-faint">
          {isVisible ? "当前状态：可见" : "当前状态：不可见"}
        </div>
      </div>
      <ModelCapabilityBadges className="justify-end" provider={active} model={model} />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`设为可见：${model}`}
          className={...}
          disabled={isVisible}
          onClick={() => makeModelVisible(model)}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        ...
      </div>
    </div>
  );
})
```

After（关键变化标注）：
```tsx
filteredFetchedModels.map((model) => {
  const isVisible = current.models.includes(model);
  const authEntry = modelHealthMap[`${active}:${model}`];
  const unauthorized = authEntry?.phase === "unauthorized";
  const checkingAuth = authEntry?.phase === "checking";
  const addDisabled = isVisible || unauthorized;
  return (
    <div key={model} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border bg-surface-panel/60 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-text-muted">{model}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[11px] text-text-faint">
            {isVisible ? "当前状态：可见" : "当前状态：不可见"}
          </span>
          {unauthorized ? (
            <HoverTip label={unauthorizedHoverLabel(authEntry?.error)}>
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                <TriangleAlert className="h-3 w-3" aria-hidden />
                未授权
              </span>
            </HoverTip>
          ) : checkingAuth ? (
            <span className="text-[11px] text-text-faint">检测中…</span>
          ) : null}
        </div>
      </div>
      <ModelCapabilityBadges className="justify-end" provider={active} model={model} />
      <div className="flex items-center gap-1.5">
        <HoverTip label={unauthorized ? unauthorizedHoverLabel(authEntry?.error) : (isVisible ? "已可见" : "设为可见")}>
          <button
            type="button"
            aria-label={`设为可见：${model}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
              isVisible
                ? "border-emerald-500/40 text-emerald-400/80"
                : unauthorized
                  ? "border-border text-text-faint opacity-40"
                  : "border-border text-text-subtle hover:bg-surface-hover hover:text-emerald-400"
            }`}
            disabled={addDisabled}
            onClick={() => makeModelVisible(model)}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </HoverTip>
        {/* "-" 按钮保持不变，不受 unauthorized 影响 */}
      </div>
    </div>
  );
})
```

`unauthorizedHoverLabel` 已在 `2026-07-25-model-health-unauthorized-badge.plan.md` 中实现，直接复用，无需重复定义。

**锚点 — 弹窗 footer 进度提示（约 L9006–9008，`共 {fetchedModels.length} 个，可见 {current.models.length} 个` 旁）：**

```tsx
<span className="text-xs text-text-faint">
  共 {fetchedModels.length} 个，可见 {current.models.length} 个
  {authProbeProgress ? `，自动检测中 ${authProbeProgress.done}/${authProbeProgress.total}` : ""}
</span>
```

**AC-2:** MOMA 场景下，`Kimi/Kimi-K2.6`（若不可见）探测完成后行内出现琥珀色「未授权」徽标，「+」按钮呈禁用态（`opacity-40` + 无法点击）；`minimax/MiniMax-M3` 等已授权模型「+」正常可点。

## no-scope-creep

只改 `desktop/src/components/SettingsPanel.tsx`（新增 import、state、函数、JSX）。不改 IPC 层（`main.ts`/`preload.ts`/`model-health.ts` 已有能力足够复用）、不改聊天选择器、不改 Enterprise。

## 验证

```bash
cd desktop && npx tsc -p electron/tsconfig.json --noEmit
cd desktop && npx vitest run tests/model-health.test.ts
```

无自动化 UI 测试覆盖此弹窗（现状如此），需人工在 Desktop `npm run dev` 内对 MOMA 厂商验收。
