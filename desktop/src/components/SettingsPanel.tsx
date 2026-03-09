import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  provider: string;
  model: string;
  apiKey: string;
  onClose: () => void;
  onSave: (payload: { provider: string; model: string; apiKey: string }) => Promise<void>;
};

export function SettingsPanel({
  open,
  provider,
  model,
  apiKey,
  onClose,
  onSave
}: Props) {
  const [providerVal, setProviderVal] = useState(provider);
  const [modelVal, setModelVal] = useState(model);
  const [apiKeyVal, setApiKeyVal] = useState(apiKey);

  useEffect(() => {
    setProviderVal(provider);
    setModelVal(model);
    setApiKeyVal(apiKey);
  }, [provider, model, apiKey, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-[90vw] w-[400px] rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-lg font-semibold">设置</h3>
        <div className="space-y-3">
          <label className="block text-sm">
            Provider
            <select
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5"
              value={providerVal}
              onChange={(e) => setProviderVal(e.target.value)}
            >
              <option value="">default</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="volcengine">volcengine</option>
              <option value="zhipu">zhipu</option>
              <option value="qianfan">qianfan</option>
              <option value="minimax">minimax</option>
            </select>
          </label>
          <label className="block text-sm">
            Model
            <input
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5"
              value={modelVal}
              onChange={(e) => setModelVal(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            API Key
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5"
              value={apiKeyVal}
              onChange={(e) => setApiKeyVal(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onClose}>
            取消
          </button>
          <button
            className="rounded-md bg-cyan-400 px-3 py-1.5 text-sm text-black"
            onClick={() => onSave({ provider: providerVal, model: modelVal, apiKey: apiKeyVal })}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
