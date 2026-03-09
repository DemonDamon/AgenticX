import { useCallback, useEffect, useMemo, useState } from "react";

const ALL_PROVIDERS = [
  "openai", "anthropic", "volcengine", "bailian",
  "zhipu", "qianfan", "minimax", "kimi", "ollama",
] as const;

type ProviderEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
};

type Props = {
  open: boolean;
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
  onClose: () => void;
  onSave: (result: {
    defaultProvider: string;
    providers: Record<string, ProviderEntry>;
  }) => Promise<void>;
};

type ModelHealth = "idle" | "checking" | "healthy" | "error";

export function SettingsPanel({ open, defaultProvider, providers, onClose, onSave }: Props) {
  const [active, setActive] = useState(defaultProvider || ALL_PROVIDERS[0]);
  const [draft, setDraft] = useState<Record<string, ProviderEntry>>({});
  const [defProv, setDefProv] = useState(defaultProvider);
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "checking" | "ok" | "fail">>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [modelHealthMap, setModelHealthMap] = useState<Record<string, ModelHealth>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [newModelInput, setNewModelInput] = useState("");

  useEffect(() => {
    if (!open) return;
    const merged: Record<string, ProviderEntry> = {};
    for (const name of ALL_PROVIDERS) {
      const saved = providers[name];
      merged[name] = {
        apiKey: saved?.apiKey ?? "",
        baseUrl: saved?.baseUrl ?? "",
        model: saved?.model ?? "",
        models: saved?.models ?? [],
      };
    }
    for (const [name, saved] of Object.entries(providers)) {
      if (!merged[name]) {
        merged[name] = {
          apiKey: saved?.apiKey ?? "",
          baseUrl: saved?.baseUrl ?? "",
          model: saved?.model ?? "",
          models: saved?.models ?? [],
        };
      }
    }
    setDraft(merged);
    setDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setActive(defaultProvider || ALL_PROVIDERS[0]);
    setKeyStatus({});
    setKeyError({});
    setModelHealthMap({});
    setShowModelPanel(false);
  }, [open, providers, defaultProvider]);

  const current = useMemo(() => draft[active] ?? { apiKey: "", baseUrl: "", model: "", models: [] }, [draft, active]);

  const updateField = useCallback(
    (field: keyof ProviderEntry, value: string | string[]) => {
      setDraft((prev) => ({
        ...prev,
        [active]: { ...prev[active], [field]: value },
      }));
    },
    [active]
  );

  const providerNames = useMemo(() => {
    const set = new Set<string>([...ALL_PROVIDERS, ...Object.keys(draft)]);
    return Array.from(set);
  }, [draft]);

  const onValidateKey = async () => {
    if (!current.apiKey) return;
    setKeyStatus((p) => ({ ...p, [active]: "checking" }));
    setKeyError((p) => ({ ...p, [active]: "" }));
    const res = await window.agenticxDesktop.validateKey({
      provider: active,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl || undefined,
    });
    setKeyStatus((p) => ({ ...p, [active]: res.ok ? "ok" : "fail" }));
    if (!res.ok) setKeyError((p) => ({ ...p, [active]: res.error ?? "未知错误" }));
  };

  const onFetchModels = async () => {
    if (!current.apiKey) return;
    setFetchingModels(true);
    const res = await window.agenticxDesktop.fetchModels({
      provider: active,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl || undefined,
    });
    setFetchingModels(false);
    if (res.ok && res.models.length > 0) {
      updateField("models", res.models);
    }
  };

  const onHealthCheck = async (model: string) => {
    const key = `${active}:${model}`;
    setModelHealthMap((p) => ({ ...p, [key]: "checking" }));
    const res = await window.agenticxDesktop.healthCheckModel({
      provider: active,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl || undefined,
      model,
    });
    setModelHealthMap((p) => ({ ...p, [key]: res.ok ? "healthy" : "error" }));
  };

  const onRemoveModel = (model: string) => {
    updateField(
      "models",
      current.models.filter((m) => m !== model)
    );
  };

  const onAddModel = () => {
    const name = newModelInput.trim();
    if (!name || current.models.includes(name)) return;
    updateField("models", [...current.models, name]);
    setNewModelInput("");
  };

  const handleSave = async () => {
    await onSave({ defaultProvider: defProv, providers: draft });
    onClose();
  };

  if (!open) return null;

  const ks = keyStatus[active] ?? "idle";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-[720px] max-w-[95vw] overflow-hidden rounded-xl border border-border bg-panel">
        {/* Left sidebar: provider list */}
        <div className="flex w-[180px] shrink-0 flex-col border-r border-border bg-slate-900/60">
          <div className="border-b border-border px-3 py-2.5 text-sm font-semibold text-slate-200">
            Provider 列表
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {providerNames.map((name) => {
              const hasKey = !!draft[name]?.apiKey;
              return (
                <button
                  key={name}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    active === name
                      ? "bg-cyan-500/15 text-cyan-400"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                  onClick={() => { setActive(name); setShowModelPanel(false); }}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasKey ? "bg-emerald-400" : "bg-slate-600"}`} />
                  <span className="truncate">{name}</span>
                  {name === defProv && (
                    <span className="ml-auto shrink-0 rounded bg-cyan-500/20 px-1 text-[10px] text-cyan-400">默认</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-200">
              {showModelPanel ? `${active} — 模型管理` : `${active} 设置`}
            </h3>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onClose}>✕</button>
          </div>

          {!showModelPanel ? (
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="space-y-3">
                {/* API Key */}
                <label className="block text-sm text-slate-300">
                  API 密钥
                  <div className="mt-1 flex gap-2">
                    <input
                      type="password"
                      className="flex-1 rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                      value={current.apiKey}
                      onChange={(e) => updateField("apiKey", e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                        ks === "checking"
                          ? "border-amber-500/50 text-amber-400"
                          : ks === "ok"
                            ? "border-emerald-500/50 text-emerald-400"
                            : ks === "fail"
                              ? "border-rose-500/50 text-rose-400"
                              : "border-border text-slate-400 hover:text-white"
                      }`}
                      disabled={ks === "checking" || !current.apiKey}
                      onClick={onValidateKey}
                    >
                      {ks === "checking" ? "检测中..." : ks === "ok" ? "有效 ✓" : ks === "fail" ? "失败 ✗" : "检 测"}
                    </button>
                  </div>
                  {ks === "fail" && keyError[active] && (
                    <div className="mt-1 text-xs text-rose-400">{keyError[active]}</div>
                  )}
                </label>

                {/* Base URL */}
                <label className="block text-sm text-slate-300">
                  API 地址
                  <span className="ml-1 text-xs text-slate-500">(留空使用默认)</span>
                  <input
                    className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                    value={current.baseUrl}
                    onChange={(e) => updateField("baseUrl", e.target.value)}
                    placeholder="https://..."
                  />
                </label>

                {/* Default model */}
                <label className="block text-sm text-slate-300">
                  默认模型
                  {current.models.length > 0 ? (
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                      value={current.model}
                      onChange={(e) => updateField("model", e.target.value)}
                    >
                      <option value="">请选择</option>
                      {current.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                      value={current.model}
                      onChange={(e) => updateField("model", e.target.value)}
                      placeholder="gpt-4o / glm-5 / doubao-seed-..."
                    />
                  )}
                </label>

                {/* Set as default */}
                <div className="flex items-center gap-3">
                  {defProv !== active && (
                    <button
                      className="rounded-md border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-400 transition hover:bg-cyan-500/10"
                      onClick={() => setDefProv(active)}
                    >
                      设为默认 Provider
                    </button>
                  )}
                  <button
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
                    onClick={() => setShowModelPanel(true)}
                  >
                    管理模型
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Model management panel */
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-3 flex gap-2">
                <button
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
                  disabled={fetchingModels || !current.apiKey}
                  onClick={onFetchModels}
                >
                  {fetchingModels ? "获取中..." : "从 API 获取模型"}
                </button>
                <button
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
                  onClick={() => setShowModelPanel(false)}
                >
                  ← 返回
                </button>
              </div>

              {/* Add model */}
              <div className="mb-3 flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                  value={newModelInput}
                  onChange={(e) => setNewModelInput(e.target.value)}
                  placeholder="手动添加模型名..."
                  onKeyDown={(e) => { if (e.key === "Enter") onAddModel(); }}
                />
                <button
                  className="shrink-0 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40"
                  disabled={!newModelInput.trim()}
                  onClick={onAddModel}
                >
                  添加
                </button>
              </div>

              {current.models.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-500">
                  暂无模型，请点击"从 API 获取模型"或手动添加
                </div>
              )}

              <div className="space-y-1">
                {current.models.map((model) => {
                  const hk = `${active}:${model}`;
                  const health = modelHealthMap[hk] ?? "idle";
                  return (
                    <div
                      key={model}
                      className="flex items-center gap-2 rounded-md border border-border/50 bg-slate-900/50 px-3 py-2"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          health === "healthy"
                            ? "bg-emerald-400"
                            : health === "error"
                              ? "bg-rose-400"
                              : health === "checking"
                                ? "bg-amber-400 animate-pulse"
                                : "bg-slate-600"
                        }`}
                      />
                      <span className="flex-1 truncate text-sm text-slate-300">{model}</span>
                      {model === current.model && (
                        <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 text-[10px] text-cyan-400">默认</span>
                      )}
                      <button
                        className="shrink-0 text-xs text-slate-500 transition hover:text-cyan-400 disabled:opacity-40"
                        disabled={health === "checking" || !current.apiKey}
                        onClick={() => onHealthCheck(model)}
                        title="健康检测"
                      >
                        {health === "checking" ? "..." : "检测"}
                      </button>
                      <button
                        className="shrink-0 text-xs text-slate-500 transition hover:text-cyan-400"
                        onClick={() => updateField("model", model)}
                        title="设为默认"
                      >
                        ⚙
                      </button>
                      <button
                        className="shrink-0 text-xs text-slate-500 transition hover:text-rose-400"
                        onClick={() => onRemoveModel(model)}
                        title="移除"
                      >
                        —
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            <button
              className="rounded-md border border-border px-4 py-1.5 text-sm text-slate-400 transition hover:bg-slate-700"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="rounded-md bg-cyan-400 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-cyan-300"
              onClick={handleSave}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
