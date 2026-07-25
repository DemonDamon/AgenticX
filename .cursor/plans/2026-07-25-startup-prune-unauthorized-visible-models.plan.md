# 启动时移出未授权的已可见模型

Planned-with: Claude Sonnet 5  
Suggested-Impl-Model: composer-2.5

## Goal

历史已「+」进可见列表（`providers.*.models`）的模型，在密钥无调用权限时仍会留在列表与聊天选择器中，用户误选即 401。客户端启动后应对**各已配置厂商的可见模型**做鉴权探测，发现未授权则自动从可见列表移出并落盘；设置页健康检查命中未授权时同样移出，避免依赖下次重启。

## Architecture

1. 纯函数：从 `ProviderCatalogEntry` 去掉指定 model ids，并修正 `model` 默认值。
2. 异步扫描：对每个 `isProviderCredentialed` 且 `enabled !== false` 的厂商，串行调用现有 `healthCheckModel` IPC；`reason === "unauthorized"` 则记入待移出集合。
3. `App.tsx` 在 `loadConfig` 写入 settings 之后、不阻塞 splash 的后台任务中执行扫描 → `saveProvider` 落盘 → `updateSettings` → 校正 `activeModel` / pane 模型。
4. `SettingsPanel` 单条/批量健康检查若返回 `unauthorized` 且该模型仍在 `current.models`，调用既有 `onRemoveModel`。

## In scope

- FR-1: 启动后后台扫描所有有凭据厂商的**可见**模型（非全量目录）。
- FR-2: 未授权模型从 `models` 移出并 `saveProvider`；若 `model` 指向被移出项则回落到剩余首项或空。
- FR-3: 若全局/窗格当前选中被移出，用 `coerceSelectableModel` 回落。
- FR-4: 有移出时 toast 提示「已移出 N 个未授权模型」。
- FR-5: 设置页健康检查命中未授权时立即从可见列表移出并落盘。
- FR-6: 「获取模型列表」弹窗探测全量目录时，对已可见且未授权的模型同样自动移出落盘。

## Out of scope

- 不探测未加入可见列表的目录模型（获取弹窗已有自动探测）。
- 不改聊天选择器灰显逻辑（移出后自然不可选）。
- 不持久化 health map；不并发探测。

## Task 1: 纯函数 + 扫描工具 + 测试

**Files:**
- Create: `desktop/src/utils/prune-unauthorized-visible-models.ts`
- Create: `desktop/src/utils/prune-unauthorized-visible-models.test.ts`

```ts
export function stripUnauthorizedModelsFromEntry(
  entry: ProviderCatalogEntry,
  unauthorizedIds: ReadonlySet<string> | string[],
): { entry: ProviderCatalogEntry; removed: string[] }

export async function scanAndPruneUnauthorizedVisibleModels(input: {
  providers: Record<string, ProviderCatalogEntry>;
  healthCheck: (args: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) => Promise<{ ok: boolean; reason?: "unauthorized" | "error"; error?: string }>;
}): Promise<{
  providers: Record<string, ProviderCatalogEntry>;
  removed: Array<{ provider: string; model: string }>;
  changedProviderIds: string[];
}>
```

规则：仅探测 `listProviderVisibleModelIds`；跳过未凭据/禁用厂商；仅 `reason === "unauthorized"` 移出（网络失败保留可见，避免误删）。

**AC-1:** `npx vitest run src/utils/prune-unauthorized-visible-models.test.ts` 绿。

## Task 2: App 启动后台清理

**Files:** Modify `desktop/src/App.tsx`

在 `loadConfig` 成功并 `updateSettings` / `setConfigLoaded(true)` 之后（可紧接 splash preload 之后，不阻塞 `startupRendererReady`），`void (async () => { ... })()`：

1. 读 `useAppStore.getState().settings.providers`
2. `scanAndPruneUnauthorizedVisibleModels` + `window.agenticxDesktop.healthCheckModel`
3. 对 `changedProviderIds` 逐个 `saveProvider`（含更新后的 `models`/`model`）
4. `updateSettings({ providers: next })`；若 active/pane 模型不在可选集合则 `coerceSelectableModel` + `setActiveModel` / `setPaneModel` / 必要时 `saveConfig` active
5. `removed.length > 0` → 复用现有 global toast：`已移出 ${n} 个未授权模型`

**AC-2:** 重启 Desktop，MOMA 可见列表含无权限的 `ZHIPU/GLM-5.2` 时，启动后该模型从可见列表消失并写回 config；聊天选择器不再出现该项。

## Task 3: Settings 健康检查即时移出

**Files:** Modify `desktop/src/components/SettingsPanel.tsx`

在 `onHealthCheck` / `onBatchHealthCheck` 得到 `healthEntryFromCheckResult` 后：若 `phase === "unauthorized"` 且 `current.models.includes(model)`，调用 `onRemoveModel(model)`。

**AC-3:** 不重启时点批量健康检查，未授权可见模型从主列表消失（不仅显示标签）。

## no-scope-creep

只改上述文件。不改 IPC 分类逻辑、不改 fetch-models 过滤、不改 Enterprise。
