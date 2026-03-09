import { useEffect, useRef } from "react";
import { ChatView } from "./components/ChatView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store";
import { stopSpeak } from "./voice/tts";
import { watchWakewordLoop } from "./voice/wakeword";

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

  const onOpenConfirm = async (requestId: string, question: string, diff?: string): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      openConfirm(requestId, question, diff);
    });

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
        provider={settings.provider}
        model={settings.model}
        apiKey={settings.apiKey}
        onClose={() => closeSettings()}
        onSave={async ({ provider, model, apiKey }) => {
          updateSettings({ provider, model, apiKey });
          await window.agenticxDesktop.saveConfig({ provider, model, apiKey });
          closeSettings();
          stopSpeak();
        }}
      />
    </div>
  );
}
