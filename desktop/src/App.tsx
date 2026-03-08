import { useEffect, useRef } from "react";
import { FloatingBall } from "./components/FloatingBall";
import { Sidebar } from "./components/Sidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store";
import { startRecording, stopRecording } from "./voice/stt";
import { stopSpeak } from "./voice/tts";
import { watchWakewordLoop } from "./voice/wakeword";

export function App() {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const status = useAppStore((s) => s.status);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const confirm = useAppStore((s) => s.confirm);
  const settings = useAppStore((s) => s.settings);
  const floatingPos = useAppStore((s) => s.floatingPos);
  const setApiBase = useAppStore((s) => s.setApiBase);
  const setApiToken = useAppStore((s) => s.setApiToken);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setStatus = useAppStore((s) => s.setStatus);
  const openConfirm = useAppStore((s) => s.openConfirm);
  const closeConfirm = useAppStore((s) => s.closeConfirm);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setFloatingPos = useAppStore((s) => s.setFloatingPos);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const pressingRef = useRef<number | null>(null);

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
    <div className="h-screen">
      <FloatingBall
        status={status}
        x={floatingPos.x}
        y={floatingPos.y}
        onMove={(x, y) => setFloatingPos(Math.max(0, x), Math.max(0, y))}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onOpenSettings={() => openSettings()}
        onQuit={() => window.close()}
        onVoicePressStart={() => {
          setStatus("listening");
          pressingRef.current = window.setTimeout(() => {
            void startRecording((text) => {
              if (text.trim()) {
                useAppStore.getState().addMessage("user", text.trim());
              }
            });
          }, 400);
        }}
        onVoicePressEnd={() => {
          if (pressingRef.current) {
            window.clearTimeout(pressingRef.current);
            pressingRef.current = null;
          }
          stopRecording();
          setStatus("idle");
        }}
      />
      {sidebarOpen && sessionId && apiBase ? (
        <Sidebar
          onClose={() => setSidebarOpen(false)}
          onOpenConfirm={onOpenConfirm}
        />
      ) : null}
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
