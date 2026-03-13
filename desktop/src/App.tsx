import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarSidebar } from "./components/AvatarSidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { OnboardingView } from "./components/OnboardingView";
import { LiteChatView } from "./components/LiteChatView";
import { PaneManager } from "./components/PaneManager";
import { SubAgentPanel } from "./components/SubAgentPanel";
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

function extractOutputFiles(summary?: string): string[] {
  if (!summary) return [];
  const marker = "产出文件:";
  const idx = summary.lastIndexOf(marker);
  if (idx < 0) return [];
  const raw = summary.slice(idx + marker.length).trim();
  if (!raw || raw === "(无)") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function App() {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const sessionId = useAppStore((s) => s.sessionId);
  const panes = useAppStore((s) => s.panes);
  const confirm = useAppStore((s) => s.confirm);
  const settings = useAppStore((s) => s.settings);
  const userMode = useAppStore((s) => s.userMode);
  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted);
  const setApiBase = useAppStore((s) => s.setApiBase);
  const setApiToken = useAppStore((s) => s.setApiToken);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setUserMode = useAppStore((s) => s.setUserMode);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setKeybindingsPanelOpen = useAppStore((s) => s.setKeybindingsPanelOpen);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const confirmStrategy = useAppStore((s) => s.confirmStrategy);
  const setConfirmStrategy = useAppStore((s) => s.setConfirmStrategy);
  const mcpServers = useAppStore((s) => s.mcpServers);
  const setMcpServers = useAppStore((s) => s.setMcpServers);
  const planMode = useAppStore((s) => s.planMode);
  const setPlanMode = useAppStore((s) => s.setPlanMode);
  const setStatus = useAppStore((s) => s.setStatus);
  const subAgents = useAppStore((s) => s.subAgents);
  const addSubAgent = useAppStore((s) => s.addSubAgent);
  const selectedSubAgent = useAppStore((s) => s.selectedSubAgent);
  const setSelectedSubAgent = useAppStore((s) => s.setSelectedSubAgent);
  const updateSubAgent = useAppStore((s) => s.updateSubAgent);
  const addSubAgentEvent = useAppStore((s) => s.addSubAgentEvent);
  const openConfirm = useAppStore((s) => s.openConfirm);
  const closeConfirm = useAppStore((s) => s.closeConfirm);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmScopeRef = useRef<string | null>(null);
  const autoApproveScopesRef = useRef<Set<string>>(new Set());
  const denyScopesRef = useRef<Set<string>>(new Set());
  const [subPanelOpen, setSubPanelOpen] = useState(true);
  const subAgentsRef = useRef(subAgents);
  const subAgentSessionRef = useRef<Record<string, string>>({});
  const staleMissCountRef = useRef<Record<string, number>>({});
  const polledEventSeenRef = useRef<Record<string, Set<string>>>({});
  const completionNotifiedRef = useRef<Set<string>>(new Set());

  const refreshMcpStatus = useCallback(async (sid: string = sessionId) => {
    if (!sid) return;
    const status = await window.agenticxDesktop.loadMcpStatus(sid);
    if (status.ok && Array.isArray(status.servers)) {
      setMcpServers(
        status.servers.map((item) => ({
          name: item.name,
          connected: Boolean(item.connected),
          command: item.command,
        }))
      );
    }
  }, [sessionId, setMcpServers]);

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
      setPaneSessionId("pane-meta", data.session_id);
      await refreshMcpStatus(data.session_id);
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
  }, [openSettings, setApiBase, setApiToken, setSessionId, setPaneSessionId, setStatus, setUserMode, setOnboardingCompleted, setConfirmStrategy, refreshMcpStatus]);

  useEffect(() => {
    subAgentsRef.current = subAgents;
  }, [subAgents]);

  const syncSubAgents = useCallback(async () => {
    if (!apiBase || !apiToken) return;
    const subAgentSids = subAgentsRef.current
      .map((s) => s.sessionId ?? "")
      .filter((s) => s.length > 0);
    const sessionIds = Array.from(
      new Set(
        [sessionId, ...panes.map((pane) => pane.sessionId), ...subAgentSids]
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
    if (sessionIds.length === 0) return;

    const runningAgents = subAgentsRef.current.filter(
      (s) => s.status === "running" || s.status === "pending" || s.status === "awaiting_confirm"
    );

    const seenRunningOrPending = new Set<string>();
    for (const sid of sessionIds) {
      try {
        const resp = await fetch(
          `${apiBase}/api/subagents/status?session_id=${encodeURIComponent(sid)}`,
          { headers: { "x-agx-desktop-token": apiToken } }
        );
        if (!resp.ok) continue;
        const data = (await resp.json()) as {
          subagents?: Array<{
            agent_id: string;
            name?: string;
            role?: string;
            task?: string;
            status?: "pending" | "running" | "completed" | "failed" | "cancelled";
            result_summary?: string;
            error_text?: string;
            recent_events?: Array<{ type?: string; data?: Record<string, unknown> }>;
            pending_confirm?: { request_id?: string; question?: string; context?: Record<string, unknown> } | null;
          }>;
        };
        if (!Array.isArray(data.subagents)) continue;

        for (const item of data.subagents) {
          const id = (item.agent_id ?? "").trim();
          if (!id) continue;
          subAgentSessionRef.current[id] = sid;

          const exists = subAgentsRef.current.some((sub) => sub.id === id);
          if (!exists) {
            addSubAgent({
              id,
              name: item.name ?? id,
              role: item.role ?? "worker",
              task: item.task ?? "",
              sessionId: sid,
            });
          }

          const status = item.status ?? "running";
          const existing = subAgentsRef.current.find((sub) => sub.id === id);
          const hasPendingConfirm = !!(item.pending_confirm?.request_id);
          const effectiveStatus =
            hasPendingConfirm
              ? "awaiting_confirm" as const
              : existing?.status === "awaiting_confirm" && status === "running"
                ? "awaiting_confirm" as const
                : status;
          if (status === "running" || status === "pending") {
            seenRunningOrPending.add(id);
            staleMissCountRef.current[id] = 0;
          }
          if (hasPendingConfirm) {
            seenRunningOrPending.add(id);
            staleMissCountRef.current[id] = 0;
          }
          const summaryText = (item.result_summary ?? "").trim();
          const outputFiles = extractOutputFiles(summaryText);
          const currentAction =
            effectiveStatus === "awaiting_confirm"
              ? existing?.currentAction || "等待你的确认"
              : status === "completed"
              ? summaryText
                ? "已完成（查看摘要）"
                : "已完成"
              : status === "failed"
                ? item.error_text || "执行异常"
                : status === "cancelled"
                  ? "已中断"
                  : "执行中";
          const pendingConfirm =
            hasPendingConfirm
              ? {
                  requestId: String(item.pending_confirm!.request_id ?? ""),
                  question: String(item.pending_confirm!.question ?? "是否确认执行？"),
                  agentId: id,
                  sessionId: sid,
                  context: item.pending_confirm!.context,
                }
              : effectiveStatus !== "awaiting_confirm"
                ? undefined
                : existing?.pendingConfirm;
          updateSubAgent(id, {
            status: effectiveStatus,
            currentAction,
            resultSummary: summaryText || undefined,
            outputFiles,
            pendingConfirm,
          });

          if (
            (effectiveStatus === "completed" || effectiveStatus === "failed") &&
            !completionNotifiedRef.current.has(id)
          ) {
            completionNotifiedRef.current.add(id);
            const agentName = item.name ?? id;
            const emoji = effectiveStatus === "completed" ? "✅" : "❌";
            const statusLabel = effectiveStatus === "completed" ? "已完成" : "执行失败";
            const summaryBody = summaryText || (effectiveStatus === "failed" ? (item.error_text || "未知错误") : "任务已结束");
            const completionMsg = `${emoji} **子智能体 ${agentName} ${statusLabel}**\n\n${summaryBody}`;
            const store = useAppStore.getState();
            const matchingPane = store.panes.find((p) => p.sessionId === sid);
            if (matchingPane) {
              store.addPaneMessage(matchingPane.id, "tool", completionMsg, id);
            }
          }

          const seen = polledEventSeenRef.current[id] ?? new Set<string>();
          polledEventSeenRef.current[id] = seen;
          for (const evt of item.recent_events ?? []) {
            const evtType = String(evt?.type ?? "");
            const evtData = (evt?.data ?? {}) as Record<string, unknown>;
            const signature = `${evtType}:${JSON.stringify(evtData)}`;
            if (seen.has(signature)) continue;
            seen.add(signature);
            if (seen.size > 300) {
              const first = seen.values().next().value as string | undefined;
              if (first) seen.delete(first);
            }
            const text =
              typeof evtData.text === "string" && evtData.text.trim()
                ? evtData.text
                : `${evtType || "event"}: ${JSON.stringify(evtData)}`;
            addSubAgentEvent(id, { type: evtType || "event", content: text });
            if (evtType === "confirm_required") {
              const reqId = String(evtData.id ?? evtData.request_id ?? "");
              const question = String(evtData.question ?? "是否确认执行？");
              const confirmCtx = (evtData.context ?? undefined) as Record<string, unknown> | undefined;
              updateSubAgent(id, {
                status: "awaiting_confirm",
                currentAction: "等待你的确认",
                pendingConfirm: reqId
                  ? { requestId: reqId, question, agentId: id, sessionId: sid, context: confirmCtx }
                  : undefined,
              });
            } else if (evtType === "confirm_response") {
              const approved = !!evtData.approved;
              updateSubAgent(id, {
                status: approved ? "running" : "cancelled",
                currentAction: approved ? "确认通过，继续执行" : "确认拒绝，已取消",
                pendingConfirm: undefined,
              });
            }
          }
        }
      } catch {
        // ignore polling failures
      }
    }

    // Guard against stale "running" badges when SSE stream closed early.
    // Do NOT auto-mark as completed when backend has no record; that's misleading.
    for (const item of subAgentsRef.current) {
      if (item.status !== "running" && item.status !== "pending" && item.status !== "awaiting_confirm") continue;
      if (seenRunningOrPending.has(item.id)) continue;
      const miss = (staleMissCountRef.current[item.id] ?? 0) + 1;
      staleMissCountRef.current[item.id] = miss;
      if (miss === 5) {
        addSubAgentEvent(item.id, {
          type: "sync",
          content: "轮询暂未发现该任务，可能会话已切换或任务已归档，继续同步中",
        });
      } else if (miss === 10) {
        updateSubAgent(item.id, {
          currentAction: "状态失联：后台暂未返回该任务，建议展开详情并重试同步",
        });
        addSubAgentEvent(item.id, {
          type: "sync",
          content: "连续轮询未找到后台记录，已标记为状态失联提示（不自动改写为完成/失败）",
        });
      }
    }
  }, [apiBase, apiToken, sessionId, panes, addSubAgent, updateSubAgent, addSubAgentEvent]);

  useEffect(() => {
    if (!apiBase || !apiToken) return;
    void syncSubAgents();
    const runningCount = subAgents.filter(
      (item) => item.status === "running" || item.status === "pending" || item.status === "awaiting_confirm"
    ).length;
    const interval = runningCount > 0 ? 1500 : 4000;
    const timer = window.setInterval(() => void syncSubAgents(), interval);
    return () => window.clearInterval(timer);
  }, [apiBase, apiToken, subAgents, syncSubAgents]);

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
      if (denyScopesRef.current.has(scope)) {
        resolve(false);
        return;
      }
      if (autoApproveScopesRef.current.has(scope)) {
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

  const cancelSubAgent = async (agentId: string) => {
    if (!apiBase || !sessionId) return;
    const targetSessionId = subAgentSessionRef.current[agentId] ?? sessionId;
    updateSubAgent(agentId, { status: "cancelled", currentAction: "用户请求中断..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "cancel", content: "已发送中断请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "running", currentAction: "中断失败，继续执行" });
      addSubAgentEvent(agentId, { type: "error", content: `中断失败: ${String(err)}` });
    }
  };

  const retrySubAgent = async (agentId: string) => {
    if (!apiBase || !sessionId) return;
    const targetSessionId = subAgentSessionRef.current[agentId] ?? sessionId;
    updateSubAgent(agentId, { status: "pending", currentAction: "正在重试..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "retry", content: "已发送重试请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "failed", currentAction: "重试失败" });
      addSubAgentEvent(agentId, { type: "error", content: `重试失败: ${String(err)}` });
    }
  };

  const resolveSubAgentConfirm = async (agentId: string, approved: boolean) => {
    if (!apiBase || !apiToken) return;
    const sub = subAgentsRef.current.find((s) => s.id === agentId);
    if (!sub?.pendingConfirm) return;
    const { requestId, sessionId: confirmSid } = sub.pendingConfirm;
    updateSubAgent(agentId, {
      status: approved ? "running" : "cancelled",
      currentAction: approved ? "确认通过，继续执行" : "确认拒绝，执行终止",
      pendingConfirm: undefined,
    });
    addSubAgentEvent(agentId, {
      type: "confirm_response",
      content: approved ? "用户确认通过" : "用户确认拒绝",
    });
    try {
      await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: confirmSid,
          request_id: requestId,
          approved,
          agent_id: agentId,
        }),
      });
    } catch {
      // confirm POST failure is non-fatal for UI
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {!onboardingCompleted ? (
        <OnboardingView onSelectMode={(mode) => void handleSelectMode(mode)} />
      ) : sessionId && apiBase ? (
        <>
          {userMode === "pro" && <AvatarSidebar />}
          <div className="flex flex-1 overflow-hidden">
            {userMode === "lite" ? (
              <LiteChatView onOpenConfirm={onOpenConfirm} />
            ) : (
              <>
                <PaneManager onOpenConfirm={onOpenConfirm} />
                <SubAgentPanel
                  open={subPanelOpen}
                  subAgents={subAgents}
                  selectedSubAgent={selectedSubAgent}
                  onToggle={() => setSubPanelOpen((v) => !v)}
                  onCancel={(agentId) => void cancelSubAgent(agentId)}
                  onRetry={(agentId) => void retrySubAgent(agentId)}
                  onChat={(agentId) => setSelectedSubAgent(agentId)}
                  onSelect={(agentId) => setSelectedSubAgent(agentId)}
                  onConfirmResolve={(agentId, approved) => void resolveSubAgentConfirm(agentId, approved)}
                />
              </>
            )}
          </div>
        </>
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
        onApprove={(policy) => {
          const scope = confirmScopeRef.current;
          if (scope) {
            if (policy === "allow-similar") {
              autoApproveScopesRef.current.add(scope);
              denyScopesRef.current.delete(scope);
            } else if (policy === "deny-similar") {
              denyScopesRef.current.add(scope);
              autoApproveScopesRef.current.delete(scope);
            }
          }
          confirmScopeRef.current = null;
          closeConfirm();
          confirmResolverRef.current?.(true);
          confirmResolverRef.current = null;
        }}
        onReject={(policy) => {
          const scope = confirmScopeRef.current;
          if (scope && policy === "deny-similar") {
            denyScopesRef.current.add(scope);
            autoApproveScopesRef.current.delete(scope);
          }
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
        sessionId={sessionId}
        mcpServers={mcpServers}
        onRefreshMcp={refreshMcpStatus}
        onClose={() => closeSettings()}
        onSave={handleSettingsSave}
      />
    </div>
  );
}
