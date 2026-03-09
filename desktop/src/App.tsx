import { useEffect, useRef } from "react";
import { ChatView } from "./components/ChatView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store";
import { stopSpeak } from "./voice/tts";
import { watchWakewordLoop } from "./voice/wakeword";

function toProviderEntries(raw: Record<string, { api_key?: string; base_url?: string; model?: string; models?: string[] }>) {
  const result: Record<string, { apiKey: string; baseUrl: string; model: string; models: string[] }> = {};
  for (const [name, cfg] of Object.entries(raw)) {
    result[name] = {
      apiKey: cfg.api_key ?? "",
      baseUrl: cfg.base_url ?? "",
      model: cfg.model ?? "",
      models: cfg.models ?? [],
    };
  }
  return result;
}

export function App() {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const confirm = useAppStore((s) => s.confirm);
  const settings = useAppStore((s) => s.settings);
  const setApiBase = useAppStore((s) => s.setApiBase);
  const setApiToken = useAppStore((s) => s.setApiToken);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const setStatus = useAppStore((s) => s.setStatus);
  const openConfirm = useAppStore((s) => s.openConfirm);
  const closeConfirm = useAppStore((s) => s.closeConfirm);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    (async () => {
      const base = await window.agenticxDesktop.getApiBase();
      const token = await window.agenticxDesktop.getApiAuthToken();
      setApiBase(base);
      setApiToken(token);
      const resp = await fetch(`${base}/api/session`, {
        headers: { "x-agx-desktop-token": token }
      });
      const data = await resp.json();
      setSessionId(data.session_id);
      const cfg = await window.agenticxDesktop.loadConfig();
      const entries = toProviderEntries(cfg.providers ?? {});
      const defP = cfg.defaultProvider ?? "";
      const defEntry = entries[defP];
      updateSettings({
        defaultProvider: defP,
        providers: entries,
        provider: defP,
        model: defEntry?.model ?? "",
        apiKey: defEntry?.apiKey ?? "",
      });
      if (defP && defEntry?.model) setActiveModel(defP, defEntry.model);
      window.agenticxDesktop.onOpenSettings(() => openSettings());
      watchWakewordLoop(async (text) => {
        if (text.trim()) {
          useAppStore.getState().addMessage("user", text.trim());
          setStatus("processing");
        } else {
          setStatus("idle");
        }
      });
    })();
  }, [openSettings, setApiBase, setApiToken, setSessionId, setStatus]);

  const onOpenConfirm = async (
    requestId: string,
    question: string,
    diff?: string,
    agentId: string = "meta"
  ): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      openConfirm(requestId, question, diff, agentId);
    });

  const handleSettingsSave = async (result: {
    defaultProvider: string;
    providers: Record<string, { apiKey: string; baseUrl: string; model: string; models: string[] }>;
  }) => {
    for (const [name, entry] of Object.entries(result.providers)) {
      if (!entry.apiKey && !entry.model && !entry.baseUrl && entry.models.length === 0) continue;
      await window.agenticxDesktop.saveProvider({
        name,
        apiKey: entry.apiKey || undefined,
        baseUrl: entry.baseUrl || undefined,
        model: entry.model || undefined,
        models: entry.models.length > 0 ? entry.models : undefined,
      });
    }
    await window.agenticxDesktop.setDefaultProvider(result.defaultProvider);

    const defEntry = result.providers[result.defaultProvider];
    updateSettings({
      defaultProvider: result.defaultProvider,
      providers: result.providers,
      provider: result.defaultProvider,
      model: defEntry?.model ?? "",
      apiKey: defEntry?.apiKey ?? "",
    });

    if (result.defaultProvider && defEntry?.model) {
      setActiveModel(result.defaultProvider, defEntry.model);
    }
    await window.agenticxDesktop.saveConfig({
      provider: result.defaultProvider,
      model: defEntry?.model ?? "",
      apiKey: defEntry?.apiKey ?? "",
    });
    stopSpeak();
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base">
      {sessionId && apiBase ? (
        <ChatView onOpenConfirm={onOpenConfirm} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          正在连接 AgenticX 服务...
        </div>
      )}

      <ConfirmDialog
        open={confirm.open}
        question={confirm.question}
        sourceLabel={confirm.agentId === "meta" ? "主智能体" : `子智能体 ${confirm.agentId}`}
        diff={confirm.diff}
        onApprove={() => {
          closeConfirm();
          confirmResolverRef.current?.(true);
          confirmResolverRef.current = null;
        }}
        onReject={() => {
          closeConfirm();
          confirmResolverRef.current?.(false);
          confirmResolverRef.current = null;
        }}
      />
      <SettingsPanel
        open={settings.open}
        defaultProvider={settings.defaultProvider}
        providers={settings.providers}
        onClose={() => closeSettings()}
        onSave={handleSettingsSave}
      />
    </div>
  );
}
