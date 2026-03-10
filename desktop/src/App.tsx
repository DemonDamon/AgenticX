import { useEffect, useRef } from "react";
import { ChatView } from "./components/ChatView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { OnboardingView } from "./components/OnboardingView";
import { LiteChatView } from "./components/LiteChatView";
import { useAppStore } from "./store";
import { stopSpeak } from "./voice/tts";
import { watchWakewordLoop } from "./voice/wakeword";
import { matchKeybinding } from "./core/keybinding-manager";

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function App() {
  const apiBase = useAppStore((s) => s.apiBase);
  const sessionId = useAppStore((s) => s.sessionId);
  const confirm = useAppStore((s) => s.confirm);
  const settings = useAppStore((s) => s.settings);
  const userMode = useAppStore((s) => s.userMode);
  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted);
  const setApiBase = useAppStore((s) => s.setApiBase);
  const setApiToken = useAppStore((s) => s.setApiToken);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const setUserMode = useAppStore((s) => s.setUserMode);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setKeybindingsPanelOpen = useAppStore((s) => s.setKeybindingsPanelOpen);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const confirmStrategy = useAppStore((s) => s.confirmStrategy);
  const setConfirmStrategy = useAppStore((s) => s.setConfirmStrategy);
  const planMode = useAppStore((s) => s.planMode);
  const setPlanMode = useAppStore((s) => s.setPlanMode);
  const setStatus = useAppStore((s) => s.setStatus);
  const openConfirm = useAppStore((s) => s.openConfirm);
  const closeConfirm = useAppStore((s) => s.closeConfirm);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmScopeRef = useRef<string | null>(null);
  const autoApproveScopesRef = useRef<Set<string>>(new Set());

  const buildConfirmScope = (
    question: string,
    context?: Record<string, unknown>
  ): string => {
    const tool = String(context?.tool ?? "");
    if (tool === "bash_exec") {
      const command = String(context?.command ?? "").trim();
      const cmdName = command.split(/\s+/)[0] || "unknown";
      return `bash_exec:${cmdName}`;
    }
    if (tool === "file_write" || tool === "file_edit") {
      const path = String(context?.path ?? "");
      const slash = path.lastIndexOf("/");
      const folder = slash > 0 ? path.slice(0, slash) : path;
      return `${tool}:${folder || "/"}`;
    }
    if (tool) return `tool:${tool}`;
    return `question:${question}`;
  };

  const applyUserMode = async (mode: "pro" | "lite") => {
    setUserMode(mode);
    const nextStrategy = mode === "lite" ? "manual" : "semi-auto";
    setConfirmStrategy(nextStrategy);
    if (mode === "lite") setPlanMode(false);
    setCommandPaletteOpen(false);
    setKeybindingsPanelOpen(false);
    await window.agenticxDesktop.saveUserMode(mode);
    await window.agenticxDesktop.saveConfirmStrategy(nextStrategy);
  };

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
      const loadedMode = cfg.userMode === "lite" ? "lite" : "pro";
      setUserMode(loadedMode);
      setOnboardingCompleted(Boolean(cfg.onboardingCompleted));
      const loadedConfirmStrategy =
        loadedMode === "lite" ? "manual" : (cfg.confirmStrategy ?? "semi-auto");
      setConfirmStrategy(loadedConfirmStrategy);
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
  }, [openSettings, setApiBase, setApiToken, setSessionId, setStatus, setUserMode, setOnboardingCompleted, setConfirmStrategy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      const action = matchKeybinding(event, userMode);
      if (!action) return;
      event.preventDefault();
      if (action === "open-command-palette") {
        setCommandPaletteOpen(true);
      } else if (action === "open-settings") {
        openSettings();
      } else if (action === "clear-messages") {
        clearMessages();
      } else if (action === "toggle-mode") {
        const nextMode = userMode === "pro" ? "lite" : "pro";
        void applyUserMode(nextMode);
      } else if (action === "toggle-plan-mode") {
        setPlanMode(!planMode);
      } else if (action === "open-keybindings") {
        setKeybindingsPanelOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    userMode,
    setCommandPaletteOpen,
    setKeybindingsPanelOpen,
    openSettings,
    clearMessages,
    setUserMode,
    setConfirmStrategy,
    planMode,
    setPlanMode,
    setKeybindingsPanelOpen,
  ]);

  const handleSelectMode = async (mode: "pro" | "lite") => {
    await applyUserMode(mode);
    setOnboardingCompleted(true);
    await window.agenticxDesktop.saveOnboardingCompleted(true);
    if (mode === "pro") openSettings();
  };

  const onOpenConfirm = async (
    requestId: string,
    question: string,
    diff?: string,
    agentId: string = "meta",
    context?: Record<string, unknown>
  ): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      if (confirmStrategy === "auto") {
        resolve(true);
        return;
      }
      const scope = buildConfirmScope(question, context);
      if (confirmStrategy === "semi-auto" && autoApproveScopesRef.current.has(scope)) {
        resolve(true);
        return;
      }
      confirmScopeRef.current = scope;
      confirmResolverRef.current = resolve;
      openConfirm(requestId, question, diff, agentId, context);
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
      {!onboardingCompleted ? (
        <OnboardingView onSelectMode={(mode) => void handleSelectMode(mode)} />
      ) : sessionId && apiBase ? (
        userMode === "lite" ? <LiteChatView onOpenConfirm={onOpenConfirm} /> : <ChatView onOpenConfirm={onOpenConfirm} />
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
        onApprove={(allowSimilar) => {
          if (confirmStrategy === "semi-auto" && allowSimilar && confirmScopeRef.current) {
            autoApproveScopesRef.current.add(confirmScopeRef.current);
          }
          confirmScopeRef.current = null;
          closeConfirm();
          confirmResolverRef.current?.(true);
          confirmResolverRef.current = null;
        }}
        onReject={() => {
          confirmScopeRef.current = null;
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
