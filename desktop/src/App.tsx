import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarSidebar } from "./components/AvatarSidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { OnboardingView } from "./components/OnboardingView";
import { LiteChatView } from "./components/LiteChatView";
import { PaneManager } from "./components/PaneManager";
import { SidebarResizer } from "./components/SidebarResizer";
import { Topbar } from "./components/Topbar";
import { useAppStore } from "./store";
import { stopSpeak } from "./voice/tts";
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
  const activePaneId = useAppStore((s) => s.activePaneId);
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
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const chatStyle = useAppStore((s) => s.chatStyle);
  const setChatStyle = useAppStore((s) => s.setChatStyle);
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
  const sessionInitDoneRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const subAgentsRef = useRef(subAgents);
  const subAgentSessionRef = useRef<Record<string, string>>({});
  const staleMissCountRef = useRef<Record<string, number>>({});
  const polledEventSeenRef = useRef<Record<string, Set<string>>>({});
  const completionNotifiedRef = useRef<Set<string>>(new Set());
  // Queue of terminal sub-agents waiting for Meta-Agent auto-report
  const autoReportQueueRef = useRef<Array<{
    agentId: string;
    agentName: string;
    summary: string;
    sessionId: string;
    status: "completed" | "failed";
    attempts?: number;
  }>>([]);
  const autoReportingRef = useRef(false);
  const directNoticeSentRef = useRef<Set<string>>(new Set());
  const activePaneSessionId = useMemo(
    () => panes.find((pane) => pane.id === activePaneId)?.sessionId ?? sessionId,
    [activePaneId, panes, sessionId]
  );
  const resolvePaneForSession = useCallback((sid: string, fallbackAgentId?: string) => {
    const store = useAppStore.getState();
    let pane = store.panes.find((p) => p.sessionId === sid);
    if (!pane && fallbackAgentId) {
      const mappedSid =
        subAgentSessionRef.current[fallbackAgentId] ??
        subAgentsRef.current.find((item) => item.id === fallbackAgentId)?.sessionId;
      if (mappedSid) {
        pane = store.panes.find((p) => p.sessionId === mappedSid);
      }
    }
    if (!pane) {
      const activePane = store.panes.find((p) => p.id === store.activePaneId);
      pane = activePane ?? store.panes[0];
    }
    return pane;
  }, []);

  const refreshMcpStatus = useCallback(async (sid?: string) => {
    const effectiveSid = sid || useAppStore.getState().sessionId;
    if (!effectiveSid) return;
    const status = await window.agenticxDesktop.loadMcpStatus(effectiveSid);
    if (status.ok && Array.isArray(status.servers)) {
      setMcpServers(
        status.servers.map((item) => ({
          name: item.name,
          connected: Boolean(item.connected),
          command: item.command,
        }))
      );
    }
  }, [setMcpServers]);

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
    if (sessionInitDoneRef.current) return;
    sessionInitDoneRef.current = true;
    (async () => {
      const base = await window.agenticxDesktop.getApiBase();
      const token = await window.agenticxDesktop.getApiAuthToken();
      setApiBase(base);
      setApiToken(token);

      let sessionCreated = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch(`${base}/api/session`, {
            headers: { "x-agx-desktop-token": token }
          });
          if (!resp.ok) {
            console.error(`[App init] /api/session HTTP ${resp.status}, attempt ${attempt + 1}`);
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          const data = await resp.json();
          if (data.session_id) {
            setSessionId(data.session_id);
            setPaneSessionId("pane-meta", data.session_id);
            await refreshMcpStatus(data.session_id).catch(() => {});
            sessionCreated = true;
            break;
          }
          console.error("[App init] /api/session returned no session_id", data);
        } catch (err) {
          console.error(`[App init] /api/session failed, attempt ${attempt + 1}:`, err);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      if (!sessionCreated) {
        console.error("[App init] all session creation attempts failed");
      }

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
      const savedActiveProvider = cfg.activeProvider ?? "";
      const savedActiveModel = cfg.activeModel ?? "";
      if (savedActiveProvider && savedActiveModel) {
        setActiveModel(savedActiveProvider, savedActiveModel);
      } else if (defP && defEntry?.model) {
        setActiveModel(defP, defEntry.model);
      }
      window.agenticxDesktop.onOpenSettings(() => openSettings());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    subAgentsRef.current = subAgents;
  }, [subAgents]);

  useEffect(() => {
    if (!selectedSubAgent) return;
    const selected = subAgents.find((item) => item.id === selectedSubAgent);
    if (!selected) {
      setSelectedSubAgent(null);
      return;
    }
    const selectedSid = (selected.sessionId ?? "").trim();
    if (selectedSid && activePaneSessionId && selectedSid !== activePaneSessionId) {
      setSelectedSubAgent(null);
    }
  }, [selectedSubAgent, subAgents, activePaneSessionId, setSelectedSubAgent]);

  const syncSubAgents = useCallback(async () => {
    if (!apiBase || !apiToken) return;
    const sessionIds = Array.from(
      new Set(
        [sessionId, ...panes.map((pane) => pane.sessionId)]
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
            provider?: string;
            model?: string;
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
              provider: item.provider ?? undefined,
              model: item.model ?? undefined,
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
            provider: item.provider ?? existing?.provider,
            model: item.model ?? existing?.model,
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
            const matchingPane = resolvePaneForSession(sid, id);
            if (matchingPane) {
              store.addPaneMessage(matchingPane.id, "tool", completionMsg, id);
            }
            console.debug("[auto-report] enqueue: agent=%s name=%s status=%s sid=%s", id, agentName, effectiveStatus, sid);
            autoReportQueueRef.current.push({
              agentId: id,
              agentName,
              summary: summaryBody,
              sessionId: sid,
              status: effectiveStatus === "completed" ? "completed" : "failed",
              attempts: 0,
            });
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
      const lastRealEvtTs =
        [...item.events].reverse().find((evt) => evt.type !== "sync")?.ts ?? 0;
      if (lastRealEvtTs > 0 && Date.now() - lastRealEvtTs < 15000) {
        // SSE has recent activity; avoid false "lost sync" warnings.
        staleMissCountRef.current[item.id] = 0;
        continue;
      }
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

  const triggerMetaReport = useCallback(async () => {
    if (autoReportingRef.current) {
      console.debug("[auto-report] skipped: already reporting");
      return;
    }
    const queue = autoReportQueueRef.current;
    if (queue.length === 0) return;
    if (!apiBase || !apiToken) return;

    console.debug("[auto-report] START: %d items in queue", queue.length, queue.map((q) => `${q.agentName}:${q.status}`));
    autoReportingRef.current = true;
    // Snapshot only; dequeue on success to avoid silent message loss.
    const batch = [...queue];

    // Group by session so each session's Meta-Agent gets one message
    const bySession = new Map<string, typeof batch>();
    for (const item of batch) {
      const existing = bySession.get(item.sessionId) ?? [];
      existing.push(item);
      bySession.set(item.sessionId, existing);
    }
    const deliveredAgentIds = new Set<string>();
    const retryAgentIds = new Set<string>();

    try {
      for (const [sid, items] of bySession) {
        const store = useAppStore.getState();
        const matchingPane = resolvePaneForSession(sid, items[0]?.agentId);
        if (!matchingPane) {
          for (const it of items) retryAgentIds.add(it.agentId);
          continue;
        }
        const emitDirectNotice = () => {
          const shouldEmit = items.some(
            (it) => (it.attempts ?? 0) === 0 && !directNoticeSentRef.current.has(it.agentId)
          );
          if (!shouldEmit) return;
          for (const it of items) directNoticeSentRef.current.add(it.agentId);
          const lines = items
            .map((it) => `- ${it.agentName}(${it.agentId}): ${it.summary.slice(0, 220)}`)
            .join("\n");
          store.addPaneMessage(
            matchingPane.id,
            "tool",
            `⚠️ 子智能体已结束，但 Meta-Agent 自动汇报暂未成功。先给你直接结果：\n${lines}`,
            "meta"
          );
        };

        const agentLines = items
          .map((it) => {
            const state = it.status === "completed" ? "已完成" : "失败";
            return `- 【${it.agentName}】(${it.agentId}) [${state}]: ${it.summary.slice(0, 300)}`;
          })
          .join("\n");
        const triggerMsg =
          `[系统通知] 以下子智能体已结束（可能成功或失败），请立即向用户主动汇报：完成情况/失败原因、产出文件列表、下一步建议。\n${agentLines}`;

        const activeProvider = store.activeProvider;
        const activeModel = store.activeModel;
        const body: Record<string, unknown> = { session_id: sid, user_input: triggerMsg };
        if (activeProvider) body.provider = activeProvider;
        if (activeModel) body.model = activeModel;

        try {
          const resp = await fetch(`${apiBase}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
            body: JSON.stringify(body),
          });
          if (!resp.ok || !resp.body) {
            emitDirectNotice();
            for (const it of items) retryAgentIds.add(it.agentId);
            continue;
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let full = "";
          let buffer = "";
          let placeholderAdded = false;
          let metaResponded = false;

          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(chunk, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const line = frame.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const payload = JSON.parse(line.slice(6));
                if (payload.type === "token" && (payload.data?.agent_id ?? "meta") === "meta") {
                  metaResponded = true;
                  full += payload.data?.text ?? "";
                  const s = useAppStore.getState();
                  if (!placeholderAdded) {
                    s.addPaneMessage(matchingPane.id, "assistant", full, "meta");
                    placeholderAdded = true;
                  } else {
                    s.updateLastPaneMessage(matchingPane.id, full);
                  }
                }
                if (payload.type === "final" && (payload.data?.agent_id ?? "meta") === "meta") {
                  metaResponded = true;
                  const finalText = String(payload.data?.text ?? "").trim();
                  if (finalText) {
                    const s = useAppStore.getState();
                    if (!placeholderAdded) {
                      s.addPaneMessage(matchingPane.id, "assistant", finalText, "meta");
                    } else {
                      s.updateLastPaneMessage(matchingPane.id, finalText);
                    }
                  }
                }
              } catch {
                // ignore malformed frames
              }
            }
          }
          if (metaResponded) {
            console.debug("[auto-report] Meta responded for sid=%s, delivered=%d", sid, items.length);
            for (const it of items) deliveredAgentIds.add(it.agentId);
          } else {
            console.debug("[auto-report] Meta did NOT respond for sid=%s, retrying %d items", sid, items.length);
            emitDirectNotice();
            for (const it of items) retryAgentIds.add(it.agentId);
          }
        } catch {
          // network error on auto-report is non-fatal, retry later.
          emitDirectNotice();
          for (const it of items) retryAgentIds.add(it.agentId);
        }
      }
      if (deliveredAgentIds.size > 0 || retryAgentIds.size > 0) {
        autoReportQueueRef.current = autoReportQueueRef.current
          .filter((it) => !deliveredAgentIds.has(it.agentId))
          .map((it) => {
            if (!retryAgentIds.has(it.agentId)) return it;
            return { ...it, attempts: (it.attempts ?? 0) + 1 };
          })
          .filter((it) => {
            // Avoid endless retries; after several failures, keep one visible notice and drop.
            if ((it.attempts ?? 0) <= 3) return true;
            const s = useAppStore.getState();
            const p = resolvePaneForSession(it.sessionId, it.agentId);
            if (p) {
              s.addPaneMessage(
                p.id,
                "tool",
                `⚠️ 子智能体 ${it.agentName} 已${it.status === "completed" ? "完成" : "失败"}，但自动汇报触发失败。请手动询问一次进展。`,
                "meta"
              );
            }
            return false;
          });
      }
    } finally {
      autoReportingRef.current = false;
    }
  }, [apiBase, apiToken, resolvePaneForSession]);

  useEffect(() => {
    if (!apiBase || !apiToken) return;
    const pollAndReport = async () => {
      await syncSubAgents();
      if (autoReportQueueRef.current.length > 0) {
        console.debug("[auto-report] queue=%d, firing triggerMetaReport", autoReportQueueRef.current.length);
        void triggerMetaReport();
      }
    };
    void pollAndReport();
    // Use a short base interval; the actual poll frequency is fast enough for both
    // active and idle scenarios without needing to tear down on subAgents changes.
    const timer = window.setInterval(() => void pollAndReport(), 2000);
    return () => window.clearInterval(timer);
    // Intentionally exclude subAgents from deps to avoid interval teardown on every
    // status update, which was causing auto-report queue to be reset before firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, apiToken, syncSubAgents, triggerMetaReport]);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("agx-theme");
      if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "dim") {
        setTheme(savedTheme);
      }
      const savedSidebarWidth = window.localStorage.getItem("agx-sidebar-width");
      if (savedSidebarWidth) {
        document.documentElement.style.setProperty("--sidebar-width", savedSidebarWidth);
      }
    } catch {
      // ignore storage failures
    }
  }, [setTheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("agx-theme", theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

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

    // Only switch active model if user hasn't manually chosen a different one yet
    const curProvider = useAppStore.getState().activeProvider;
    const curModel = useAppStore.getState().activeModel;
    if (!curProvider || !curModel) {
      if (result.defaultProvider && defEntry?.model) {
        setActiveModel(result.defaultProvider, defEntry.model);
      }
    }
    await window.agenticxDesktop.saveConfig({
      provider: result.defaultProvider,
      model: defEntry?.model ?? "",
      apiKey: defEntry?.apiKey ?? "",
    });
    stopSpeak();
  };

  const handleConfirmStrategyChange = async (strategy: "manual" | "semi-auto" | "auto") => {
    setConfirmStrategy(strategy);
    await window.agenticxDesktop.saveConfirmStrategy(strategy);
  };

  return (
    <div className={`agx-app ${sidebarCollapsed || userMode !== "pro" || !onboardingCompleted || !apiBase ? "sidebar-collapsed" : ""}`}>
      {!onboardingCompleted ? (
        <OnboardingView onSelectMode={(mode) => void handleSelectMode(mode)} />
      ) : apiBase ? (
        <>
          {userMode === "pro" && !sidebarCollapsed ? (
            <div className="agx-sidebar-shell">
              <AvatarSidebar />
              <SidebarResizer />
            </div>
          ) : null}
          <div className="agx-main-shell">
            {userMode === "pro" ? (
              <Topbar
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
              />
            ) : null}
            <div className="agx-content">
              <div className="agx-main-content">
                {userMode === "lite" ? (
                  <LiteChatView onOpenConfirm={onOpenConfirm} />
                ) : (
                  <PaneManager onOpenConfirm={onOpenConfirm} />
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-text-faint">
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
            if (policy === "use-allowlist") {
              autoApproveScopesRef.current.add(scope);
              denyScopesRef.current.delete(scope);
            }
          }
          if (policy === "run-everything") {
            setConfirmStrategy("auto");
            void window.agenticxDesktop.saveConfirmStrategy("auto");
          }
          confirmScopeRef.current = null;
          closeConfirm();
          confirmResolverRef.current?.(true);
          confirmResolverRef.current = null;
        }}
        onReject={(policy) => {
          void policy; // reserved for future policy-specific reject handling
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
        confirmStrategy={confirmStrategy}
        theme={theme}
        chatStyle={chatStyle}
        onThemeChange={setTheme}
        onChatStyleChange={setChatStyle}
        onConfirmStrategyChange={handleConfirmStrategyChange}
        onClose={() => closeSettings()}
        onSave={handleSettingsSave}
      />
    </div>
  );
}
