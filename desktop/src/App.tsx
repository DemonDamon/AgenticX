import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarSidebar } from "./components/AvatarSidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { LiteChatView } from "./components/LiteChatView";
import { PaneManager } from "./components/PaneManager";
import { SidebarResizer } from "./components/SidebarResizer";
import { Topbar } from "./components/Topbar";
import type { ForwardConfirmPayload } from "./components/ForwardPicker";
import { rememberSessionForAvatar } from "./utils/avatar-last-session";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./utils/session-message-map";
import type { Message, ProviderEntry } from "./store";
import { useAppStore } from "./store";
import { stopSpeak } from "./voice/tts";
import { matchKeybinding } from "./core/keybinding-manager";

const WORKSPACE_STATE_STORAGE_KEY = "agx-workspace-state-v1";

type PersistedPaneState = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  modelProvider?: string;
  modelName?: string;
  historyOpen: boolean;
  contextInherited: boolean;
  taskspacePanelOpen: boolean;
  membersPanelOpen: boolean;
  sidePanelTab: "workspace" | "members";
  activeTaskspaceId: string | null;
  spawnsColumnOpen?: boolean;
  spawnsColumnSuppressAuto?: boolean;
  spawnsColumnBaselineIds?: string[];
  sessionTokens?: { input: number; output: number };
};

type PersistedWorkspaceState = {
  sessionId: string;
  activePaneId: string;
  panes: PersistedPaneState[];
};

function toProviderEntries(
  raw: Record<
    string,
    {
      api_key?: string;
      base_url?: string;
      model?: string;
      models?: string[];
      enabled?: boolean;
      drop_params?: boolean;
      display_name?: string;
      interface?: "openai";
    }
  >
): Record<string, ProviderEntry> {
  const result: Record<string, ProviderEntry> = {};
  for (const [name, cfg] of Object.entries(raw)) {
    if (cfg == null || typeof cfg !== "object" || Array.isArray(cfg)) {
      continue;
    }
    const displayName = (cfg.display_name ?? "").trim();
    const row: ProviderEntry = {
      apiKey: cfg.api_key ?? "",
      baseUrl: cfg.base_url ?? "",
      model: cfg.model ?? "",
      models: cfg.models ?? [],
      enabled: cfg.enabled !== false,
      dropParams: cfg.drop_params === true,
    };
    if (displayName) row.displayName = displayName;
    if (cfg.interface === "openai") row.interface = "openai";
    result[name] = row;
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

/** xterm 内部（含隐藏 textarea / canvas）；避免全局快捷键抢走内嵌终端按键。 */
function isInsideXterm(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest(".xterm"));
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

function normalizePersistedWorkspaceState(raw: unknown): PersistedWorkspaceState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sessionId = String(obj.sessionId ?? "").trim();
  const activePaneId = String(obj.activePaneId ?? "").trim();
  const panesRaw = Array.isArray(obj.panes) ? obj.panes : [];
  const panes: PersistedPaneState[] = panesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      const avatarName = String(row.avatarName ?? "").trim();
      if (!id || !avatarName) return null;
      const baselineRaw = row.spawnsColumnBaselineIds;
      const baselineIds = Array.isArray(baselineRaw)
        ? baselineRaw.map((x) => String(x)).filter((x) => x.length > 0)
        : [];
      const sessionTokensRaw =
        row.sessionTokens && typeof row.sessionTokens === "object"
          ? (row.sessionTokens as Record<string, unknown>)
          : null;
      const tokInput = Number(sessionTokensRaw?.input ?? 0);
      const tokOutput = Number(sessionTokensRaw?.output ?? 0);
      return {
        id,
        avatarId: row.avatarId == null ? null : String(row.avatarId),
        avatarName,
        sessionId: String(row.sessionId ?? "").trim(),
        modelProvider: String(row.modelProvider ?? "").trim(),
        modelName: String(row.modelName ?? "").trim(),
        historyOpen: Boolean(row.historyOpen),
        contextInherited: Boolean(row.contextInherited),
        taskspacePanelOpen: Boolean(row.taskspacePanelOpen),
        membersPanelOpen: Boolean(row.membersPanelOpen),
        sidePanelTab: row.sidePanelTab === "members" ? ("members" as const) : ("workspace" as const),
        activeTaskspaceId: row.activeTaskspaceId == null ? null : String(row.activeTaskspaceId),
        spawnsColumnOpen: typeof row.spawnsColumnOpen === "boolean" ? row.spawnsColumnOpen : undefined,
        spawnsColumnSuppressAuto:
          typeof row.spawnsColumnSuppressAuto === "boolean" ? row.spawnsColumnSuppressAuto : undefined,
        spawnsColumnBaselineIds: baselineIds.length > 0 ? baselineIds : undefined,
        sessionTokens: {
          input: Number.isFinite(tokInput) && tokInput > 0 ? Math.floor(tokInput) : 0,
          output: Number.isFinite(tokOutput) && tokOutput > 0 ? Math.floor(tokOutput) : 0,
        },
      };
    })
    .filter((item): item is PersistedPaneState => !!item);
  if (panes.length === 0) return null;
  return { sessionId, activePaneId, panes };
}

type SessionListItem = {
  session_id: string;
  avatar_id: string | null;
  updated_at: number;
  created_at?: number;
  archived?: boolean;
  provider?: string;
  model?: string;
};

function isSessionItemMatchingAvatar(item: SessionListItem, avatarId?: string | null): boolean {
  const targetAvatarId = (avatarId ?? "").trim();
  const itemAvatarId = String(item.avatar_id ?? "").trim();
  if (!targetAvatarId) return itemAvatarId.length === 0;
  return itemAvatarId === targetAvatarId;
}

function pickMostRecentSessionId(
  sessions: SessionListItem[],
  avatarId?: string | null
): string | undefined {
  const sorted = [...sessions]
    .filter((item) => {
      const sid = String(item.session_id ?? "").trim();
      if (!sid) return false;
      if (item.archived === true) return false;
      return isSessionItemMatchingAvatar(item, avatarId);
    })
    .sort((a, b) => {
      const ua = Number.isFinite(a.updated_at) ? a.updated_at : 0;
      const ub = Number.isFinite(b.updated_at) ? b.updated_at : 0;
      if (ub !== ua) return ub - ua;
      const ca = Number.isFinite(a.created_at ?? NaN) ? (a.created_at as number) : 0;
      const cb = Number.isFinite(b.created_at ?? NaN) ? (b.created_at as number) : 0;
      return cb - ca;
    });
  const sid = sorted[0]?.session_id;
  return sid ? String(sid).trim() : undefined;
}

async function requestSession(
  base: string,
  token: string,
  params?: { sessionId?: string; avatarId?: string | null }
): Promise<string> {
  const query = new URLSearchParams();
  const wantedSessionId = String(params?.sessionId ?? "").trim();
  const avatarId = String(params?.avatarId ?? "").trim();
  if (wantedSessionId) query.set("session_id", wantedSessionId);
  if (avatarId) query.set("avatar_id", avatarId);
  const resp = await fetch(`${base}/api/session${query.size > 0 ? `?${query.toString()}` : ""}`, {
    headers: { "x-agx-desktop-token": token },
  });
  if (!resp.ok) throw new Error(`/api/session HTTP ${resp.status}`);
  const data = (await resp.json()) as { session_id?: string };
  const sid = String(data.session_id ?? "").trim();
  if (!sid) throw new Error("/api/session returned empty session_id");
  return sid;
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
  const setAgxAccount = useAppStore((s) => s.setAgxAccount);
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
  const setPaneModel = useAppStore((s) => s.setPaneModel);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmScopeRef = useRef<string | null>(null);
  const autoApproveScopesRef = useRef<Set<string>>(new Set());
  const denyScopesRef = useRef<Set<string>>(new Set());
  const sessionInitDoneRef = useRef(false);
  const workspaceHydratedRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [windowResizing, setWindowResizing] = useState(false);
  const [startupOptimizing, setStartupOptimizing] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const windowResizeTimerRef = useRef<number | null>(null);
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
  // Track live automation-triggered sessions; used to poll and refresh tool/message progress.
  const automationRunningRef = useRef<Map<string, Set<string>>>(new Map());
  const automationPollTimerRef = useRef<number | null>(null);
  const activePaneSessionId = useMemo(
    () => panes.find((pane) => pane.id === activePaneId)?.sessionId ?? sessionId,
    [activePaneId, panes, sessionId]
  );

  useEffect(() => {
    const activePane = panes.find((pane) => pane.id === activePaneId);
    const sid = String(activePane?.sessionId ?? "").trim();
    if (!sid) return;
    rememberSessionForAvatar(activePane?.avatarId ?? null, sid);
  }, [activePaneId, panes]);
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
          connection_state: item.connection_state,
          tool_count: typeof item.tool_count === "number" ? item.tool_count : undefined,
          error_detail: item.error_detail,
          op_phase: typeof item.op_phase === "string" ? item.op_phase : undefined,
          op_message: typeof item.op_message === "string" ? item.op_message : undefined,
          op_updated_at: typeof item.op_updated_at === "number" ? item.op_updated_at : undefined,
        }))
      );
    }
  }, [setMcpServers]);

  const ensureMcpAutoConnectOnStartup = useCallback(async (sid?: string) => {
    const effectiveSid = (sid || useAppStore.getState().sessionId || "").trim();
    if (!effectiveSid) return;
    try {
      const [settings, status] = await Promise.all([
        window.agenticxDesktop.getMcpSettings(),
        window.agenticxDesktop.loadMcpStatus(effectiveSid),
      ]);
      if (!settings.ok || !Array.isArray(settings.auto_connect) || settings.auto_connect.length === 0) {
        return;
      }
      if (!status.ok || !Array.isArray(status.servers) || status.servers.length === 0) {
        return;
      }
      const wanted = new Set(settings.auto_connect.map((name) => String(name || "").trim()).filter(Boolean));
      if (wanted.size === 0) return;
      const toConnect = status.servers
        .filter((server) => wanted.has(server.name) && !server.connected)
        .map((server) => server.name);
      if (toConnect.length === 0) return;
      const results = await Promise.all(
        toConnect.map(async (name) => {
          try {
            const result = await window.agenticxDesktop.connectMcp({ sessionId: effectiveSid, name });
            return { name, ok: Boolean(result?.ok), error: result?.error };
          } catch (error) {
            return { name, ok: false, error: String(error) };
          }
        })
      );
      const failed = results.filter((item) => !item.ok);
      if (failed.length > 0) {
        console.warn(
          "[App init] MCP startup auto-connect partial failure:",
          failed.map((item) => ({ name: item.name, error: item.error })),
        );
      }
      await refreshMcpStatus(effectiveSid);
    } catch (error) {
      // Best effort: startup MCP auto-connect should never block app init.
      console.warn("[App init] MCP startup auto-connect failed:", error);
    }
  }, [refreshMcpStatus]);

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

  useEffect(() => {
    if (sessionInitDoneRef.current) return;
    sessionInitDoneRef.current = true;
    (async () => {
      try {
      const base = await window.agenticxDesktop.getApiBase();
      const token = await window.agenticxDesktop.getApiAuthToken();
      setApiBase(base);
      setApiToken(token);

      // Load basic user-config first so the UI can render ASAP (userMode / onboarding).
      // 会话恢复/MCP 状态属于次要副作用，单独放后面；哪怕下面串行 /api/session 稍慢，也不会把 UI 卡在 loading。
      try {
        const cfgEarly = await window.agenticxDesktop.loadConfig();
        // Lite 模式已废弃：所有用户强制走 Pro，旧配置里若保存过 lite 则自动纠正并持久化。
        const loadedMode: "pro" | "lite" = "pro";
        setUserMode(loadedMode);
        if (cfgEarly.userMode === "lite") {
          try {
            await window.agenticxDesktop.saveUserMode("pro");
          } catch {
            // 写回失败不阻塞启动，下次运行仍会在这里再次纠正。
          }
        }
        // Pro/Lite 欢迎页已移除；主进程 load-config 始终返回 onboardingCompleted: true，
        // 并与旧配置中 onboarding_completed: false 做一次写回迁移。
        setOnboardingCompleted(true);
        const loadedConfirmStrategy = cfgEarly.confirmStrategy ?? "semi-auto";
        setConfirmStrategy(loadedConfirmStrategy);
        const entries = toProviderEntries(cfgEarly.providers ?? {});
        const defP = cfgEarly.defaultProvider ?? "";
        const defEntry = entries[defP];
        updateSettings({
          defaultProvider: defP,
          providers: entries,
          provider: defP,
          model: defEntry?.model ?? "",
          apiKey: defEntry?.apiKey ?? "",
        });
        const savedActiveProvider = cfgEarly.activeProvider ?? "";
        const savedActiveModel = cfgEarly.activeModel ?? "";
        if (savedActiveProvider && savedActiveModel) {
          setActiveModel(savedActiveProvider, savedActiveModel);
          const currentPaneId = useAppStore.getState().activePaneId;
          const currentPane = useAppStore.getState().panes.find((pane) => pane.id === currentPaneId);
          const hasPaneModel = Boolean(currentPane?.modelProvider?.trim() && currentPane?.modelName?.trim());
          if (!hasPaneModel) {
            setPaneModel(currentPaneId, savedActiveProvider, savedActiveModel);
          }
        } else if (defP && defEntry?.model) {
          setActiveModel(defP, defEntry.model);
          const currentPaneId = useAppStore.getState().activePaneId;
          const currentPane = useAppStore.getState().panes.find((pane) => pane.id === currentPaneId);
          const hasPaneModel = Boolean(currentPane?.modelProvider?.trim() && currentPane?.modelName?.trim());
          if (!hasPaneModel) {
            setPaneModel(currentPaneId, defP, defEntry.model);
          }
        }
      } catch (err) {
        console.error("[App init] loadConfig failed:", err);
      } finally {
        // 配置已经载入（或出错），让 UI 立刻渲染，避免被后续会话恢复挡住。
        setConfigLoaded(true);
      }

      // Preload avatar list into the store BEFORE pane hydration, so the
      // setPaneSessionId() fallback chain (session > avatar.default > global)
      // can actually resolve an avatar's default_provider/default_model on
      // cold start. Without this, the first render falls through to "未选模型"
      // until the AvatarSidebar component finishes its own lazy refresh.
      try {
        const avResp = await window.agenticxDesktop.listAvatars();
        if (avResp?.ok && Array.isArray(avResp.avatars)) {
          useAppStore.getState().setAvatars(
            avResp.avatars.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role ?? "",
              avatarUrl: a.avatar_url ?? "",
              pinned: Boolean(a.pinned),
              createdBy: a.created_by ?? "manual",
              systemPrompt: a.system_prompt ?? "",
              toolsEnabled: a.tools_enabled ?? {},
              skillsEnabled:
                a.skills_enabled && typeof a.skills_enabled === "object"
                  ? { ...a.skills_enabled }
                  : undefined,
              defaultProvider: a.default_provider ?? "",
              defaultModel: a.default_model ?? "",
            })),
          );
        }
      } catch (err) {
        console.error("[App init] preload avatars failed:", err);
      }

      let recovered = false;
      try {
        const raw = window.localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const saved = normalizePersistedWorkspaceState(parsed);
        const sessionsCache = new Map<string, SessionListItem[]>();
        const recentSidCache = new Map<string, string>();
        const getSessionsForAvatar = async (avatarId?: string | null): Promise<SessionListItem[]> => {
          const key = (avatarId ?? "").trim();
          if (sessionsCache.has(key)) return sessionsCache.get(key) ?? [];
          try {
            const listed = await window.agenticxDesktop.listSessions(key || undefined);
            if (!listed.ok || !Array.isArray(listed.sessions) || listed.sessions.length === 0) {
              sessionsCache.set(key, []);
              return [];
            }
            const normalized = listed.sessions.filter((item) => isSessionItemMatchingAvatar(item, key || undefined));
            sessionsCache.set(key, normalized);
            return normalized;
          } catch {
            sessionsCache.set(key, []);
            return [];
          }
        };
        const isSessionCompatible = async (sid: string, avatarId?: string | null): Promise<boolean> => {
          const needle = sid.trim();
          if (!needle) return false;
          const rows = await getSessionsForAvatar(avatarId);
          return rows.some((item) => String(item.session_id ?? "").trim() === needle);
        };
        const getRecentSessionId = async (avatarId?: string | null): Promise<string | undefined> => {
          const key = (avatarId ?? "").trim();
          if (recentSidCache.has(key)) return recentSidCache.get(key) || undefined;
          const rows = await getSessionsForAvatar(key || undefined);
          if (rows.length === 0) {
            recentSidCache.set(key, "");
            return undefined;
          }
          const sid = pickMostRecentSessionId(rows, key || undefined);
          recentSidCache.set(key, sid ?? "");
          return sid;
        };
        if (saved) {
          const hydratedPanes: PersistedPaneState[] = [];
          const claimedSessionIds = new Set<string>();
          for (const pane of saved.panes) {
            try {
              const isGroupPane = String(pane.avatarId ?? "").startsWith("group:");
              const isAutomationTaskPane = String(pane.avatarId ?? "").startsWith("automation:");
              const lazyEligible = !isGroupPane && !isAutomationTaskPane;

              let wantedSid = String(pane.sessionId ?? "").trim();
              if (wantedSid && !(await isSessionCompatible(wantedSid, pane.avatarId))) {
                wantedSid = "";
              }

              if (!wantedSid && !lazyEligible) {
                const recent = await getRecentSessionId(pane.avatarId ?? undefined);
                wantedSid = String(recent ?? "").trim();
              }

              if (wantedSid && claimedSessionIds.has(wantedSid)) {
                console.warn(
                  "[App init] duplicate sessionId %s across panes — forcing new session for pane %s (avatar=%s)",
                  wantedSid,
                  pane.id,
                  pane.avatarId,
                );
                if (lazyEligible) {
                  wantedSid = "";
                } else {
                  const sid = await requestSession(base, token, { avatarId: pane.avatarId });
                  claimedSessionIds.add(sid);
                  hydratedPanes.push({ ...pane, sessionId: sid });
                  continue;
                }
              }

              if (!wantedSid) {
                if (lazyEligible) {
                  hydratedPanes.push({ ...pane, sessionId: "" });
                  continue;
                }
                const sid = await requestSession(base, token, { avatarId: pane.avatarId });
                claimedSessionIds.add(sid);
                hydratedPanes.push({ ...pane, sessionId: sid });
                continue;
              }

              // Pass sessionId and avatarId together so /api/session can validate binding and
              // create a correctly scoped session if the old sid is missing (restart / mismatch).
              const sid = await requestSession(
                base,
                token,
                { sessionId: wantedSid, avatarId: pane.avatarId }
              );
              claimedSessionIds.add(sid);
              hydratedPanes.push({ ...pane, sessionId: sid });
            } catch (err) {
              console.error("[App init] restore pane failed:", pane.id, err);
            }
          }
          if (hydratedPanes.length > 0) {
            const nextActivePaneId =
              hydratedPanes.some((pane) => pane.id === saved.activePaneId)
                ? saved.activePaneId
                : hydratedPanes[0].id;
            useAppStore.setState({
              panes: hydratedPanes.map((pane) => ({
                ...pane,
                messages: [],
                sessionTokens: pane.sessionTokens ?? { input: 0, output: 0 },
                historySearchTerms: [],
                modelProvider: pane.modelProvider ?? "",
                modelName: pane.modelName ?? "",
                membersPanelOpen: pane.membersPanelOpen ?? false,
                sidePanelTab: pane.sidePanelTab ?? "workspace",
                spawnsColumnOpen: pane.spawnsColumnOpen ?? false,
                spawnsColumnSuppressAuto: pane.spawnsColumnSuppressAuto ?? false,
                spawnsColumnBaselineIds: pane.spawnsColumnBaselineIds ?? [],
                terminalTabs: [],
                activeTerminalTabId: null,
              })),
              activePaneId: nextActivePaneId,
            });
            // Re-apply sid bindings so store can restore per-session token cache
            // and seed the model from the newly-returned session.provider/model
            // field (S1). If the session has no remembered model, the store
            // fallback chain (avatar.default > global.default) kicks in.
            for (const pane of hydratedPanes) {
              let hintProvider: string | undefined;
              let hintModel: string | undefined;
              const sid = String(pane.sessionId ?? "").trim();
              if (sid) {
                const rows = await getSessionsForAvatar(pane.avatarId ?? undefined).catch(() => []);
                const row = rows.find((r) => String(r.session_id ?? "").trim() === sid);
                hintProvider = row?.provider?.trim() || undefined;
                hintModel = row?.model?.trim() || undefined;
              }
              setPaneSessionId(pane.id, pane.sessionId, {
                provider: hintProvider,
                model: hintModel,
              });
            }
            // After binding, ensure activeProvider/activeModel follows the active pane.
            const activeState = useAppStore.getState();
            const activePane = activeState.panes.find((p) => p.id === activeState.activePaneId);
            if (activePane?.modelProvider && activePane?.modelName) {
              activeState.setActiveModel(activePane.modelProvider, activePane.modelName);
            }
            const metaPane = hydratedPanes.find((pane) => pane.id === "pane-meta");
            const nextSessionId =
              (metaPane?.sessionId ?? "").trim() ||
              (hydratedPanes.find((pane) => pane.id === nextActivePaneId)?.sessionId ?? "").trim() ||
              saved.sessionId;
            if (nextSessionId) {
              setSessionId(nextSessionId);
              await refreshMcpStatus(nextSessionId).catch(() => {});
              await ensureMcpAutoConnectOnStartup(nextSessionId).catch(() => {});
              recovered = true;
            }
          }
        }
      } catch (err) {
        console.error("[App init] restore workspace state failed:", err);
      }

      if (!recovered) {
        let sessionCreated = false;
        const latestSid = await (async () => {
          try {
            const listed = await window.agenticxDesktop.listSessions();
            if (!listed.ok || !Array.isArray(listed.sessions) || listed.sessions.length === 0) return undefined;
            return pickMostRecentSessionId(listed.sessions, null);
          } catch {
            return undefined;
          }
        })();
        if (latestSid) {
          try {
            const sid = await requestSession(base, token, { sessionId: latestSid });
            setSessionId(sid);
            setPaneSessionId("pane-meta", sid);
            await refreshMcpStatus(sid).catch(() => {});
            await ensureMcpAutoConnectOnStartup(sid).catch(() => {});
            sessionCreated = true;
            recovered = true;
          } catch (err) {
            console.error("[App init] reuse latest session failed:", err);
          }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          if (sessionCreated) break;
          try {
            const sid = await requestSession(base, token);
            setSessionId(sid);
            setPaneSessionId("pane-meta", sid);
            await refreshMcpStatus(sid).catch(() => {});
            await ensureMcpAutoConnectOnStartup(sid).catch(() => {});
            sessionCreated = true;
            break;
          } catch (err) {
            console.error(`[App init] /api/session failed, attempt ${attempt + 1}:`, err);
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        if (!sessionCreated) {
          console.error("[App init] all session creation attempts failed");
        }
      }

      window.agenticxDesktop.onOpenSettings(() => openSettings());
      workspaceHydratedRef.current = true;
      } catch (err) {
        console.error("[App init] fatal", err);
      } finally {
        // 兜底：任何异常也要放行 UI。
        setConfigLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureMcpAutoConnectOnStartup, refreshMcpStatus]);

  useEffect(() => {
    if (!workspaceHydratedRef.current) return;
    const snapshot: PersistedWorkspaceState = {
      sessionId,
      activePaneId,
      panes: panes.map((pane) => ({
        id: pane.id,
        avatarId: pane.avatarId,
        avatarName: pane.avatarName,
        sessionId: pane.sessionId,
        modelProvider: pane.modelProvider,
        modelName: pane.modelName,
        historyOpen: pane.historyOpen,
        contextInherited: pane.contextInherited,
        taskspacePanelOpen: pane.taskspacePanelOpen,
        membersPanelOpen: pane.membersPanelOpen,
        sidePanelTab: pane.sidePanelTab,
        activeTaskspaceId: pane.activeTaskspaceId,
        spawnsColumnOpen: pane.spawnsColumnOpen,
        spawnsColumnSuppressAuto: pane.spawnsColumnSuppressAuto,
        spawnsColumnBaselineIds: pane.spawnsColumnBaselineIds,
        sessionTokens: pane.sessionTokens,
      })),
    };
    try {
      window.localStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage failures
    }
  }, [sessionId, activePaneId, panes]);

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
            `⚠️ 子智能体已结束，但 Machi 自动汇报暂未成功。先给你直接结果：\n${lines}`,
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

        const paneProvider = String(matchingPane.modelProvider ?? "").trim();
        const paneModel = String(matchingPane.modelName ?? "").trim();
        const activeProvider = paneProvider || store.activeProvider;
        const activeModel = paneModel || store.activeModel;
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
          let reportResponded = false;

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
                if (payload.type === "token") {
                  const tokenText = String(payload.data?.text ?? payload.data?.content ?? "");
                  if (tokenText.length === 0) continue;
                  reportResponded = true;
                  full += tokenText;
                  const s = useAppStore.getState();
                  if (!placeholderAdded) {
                    s.addPaneMessage(matchingPane.id, "assistant", full, "meta");
                    placeholderAdded = true;
                  } else {
                    s.updateLastPaneMessage(matchingPane.id, full);
                  }
                }
                if (payload.type === "final") {
                  const finalText = String(payload.data?.text ?? payload.data?.content ?? "").trim();
                  if (finalText) {
                    reportResponded = true;
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
          if (reportResponded) {
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
    // Initial account hydration and subscription to device-flow OAuth events.
    // Both Topbar and Settings → AccountTab consume agxAccount via store; keep them in sync.
    let cancelled = false;
    void (async () => {
      try {
        const r = await window.agenticxDesktop.loadAgxAccount();
        if (cancelled || !r.ok) return;
        setAgxAccount({
          loggedIn: Boolean(r.loggedIn),
          email: String(r.email ?? ""),
          displayName: String(r.displayName ?? ""),
        });
      } catch {
        // ignore; account is optional for most local workflows
      }
    })();

    const offChanged = window.agenticxDesktop.onAgxAccountChanged((payload) => {
      const email = String(payload.email ?? "");
      const displayName = String(payload.displayName ?? "");
      setAgxAccount({ loggedIn: Boolean(email.trim()), email, displayName });
    });
    const offTimeout = window.agenticxDesktop.onAgxAccountLoginTimeout(() => {
      void window.agenticxDesktop.confirmDialog({
        title: "登录等待超时",
        message: "未在有效时间内完成官网登录确认。请重新点击「登录」再试。",
        detail: "错误代码 AGX-AUTH-201（向支持反馈时请一并提供）",
        confirmText: "确定",
      });
    });
    return () => {
      cancelled = true;
      offChanged();
      offTimeout();
    };
  }, [setAgxAccount]);

  useEffect(() => {
    const onWindowResize = () => {
      setWindowResizing(true);
      if (windowResizeTimerRef.current !== null) {
        window.clearTimeout(windowResizeTimerRef.current);
      }
      windowResizeTimerRef.current = window.setTimeout(() => {
        setWindowResizing(false);
        windowResizeTimerRef.current = null;
      }, 140);
    };
    window.addEventListener("resize", onWindowResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onWindowResize);
      if (windowResizeTimerRef.current !== null) {
        window.clearTimeout(windowResizeTimerRef.current);
        windowResizeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStartupOptimizing(false);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target) || isInsideXterm(event.target)) return;
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
        // Lite 模式已废弃，快捷键不再切换；保留 case 分支避免命中 default。
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

  const onOpenConfirm = async (
    requestId: string,
    question: string,
    diff?: string,
    agentId: string = "meta",
    context?: Record<string, unknown>
  ): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      if (useAppStore.getState().confirmStrategy === "auto") {
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
    providers: Record<string, ProviderEntry>;
  }) => {
    const resolveFallbackModel = (): { provider: string; model: string } | null => {
      const candidates = Object.entries(result.providers)
        .filter(([, entry]) => entry.enabled !== false)
        .map(([provider, entry]) => {
          const model = entry.model || entry.models[0] || "";
          return { provider, model };
        })
        .filter((row) => row.model);
      if (candidates.length === 0) return null;
      const preferred = candidates.find((row) => row.provider === result.defaultProvider);
      return preferred ?? candidates[0];
    };

    for (const [name, entry] of Object.entries(result.providers)) {
      const hasCustomVendorMeta = Boolean(entry.displayName?.trim()) || entry.interface === "openai";
      if (
        !hasCustomVendorMeta &&
        !entry.apiKey &&
        !entry.model &&
        !entry.baseUrl &&
        entry.models.length === 0 &&
        entry.enabled !== false
      ) {
        continue;
      }
      await window.agenticxDesktop.saveProvider({
        name,
        apiKey: entry.apiKey || undefined,
        baseUrl: entry.baseUrl || undefined,
        model: entry.model || undefined,
        models: entry.models.length > 0 ? entry.models : undefined,
        enabled: entry.enabled,
        dropParams: entry.dropParams,
        // displayName 未出现在对象上时不传，避免误删 YAML；显式传空串表示用户清空展示名
        ...(entry.displayName !== undefined ? { displayName: entry.displayName.trim() } : {}),
        ...(entry.interface === "openai" ? { interface: "openai" as const } : {}),
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
    const currentEntry = result.providers[curProvider];
    const currentModelStillVisible =
      !!curProvider &&
      !!curModel &&
      currentEntry?.enabled !== false &&
      (currentEntry?.model === curModel || currentEntry?.models.includes(curModel));
    if (!currentModelStillVisible) {
      const fallback = resolveFallbackModel();
      if (fallback) {
        setActiveModel(fallback.provider, fallback.model);
        const currentPaneId = useAppStore.getState().activePaneId;
        setPaneModel(currentPaneId, fallback.provider, fallback.model);
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

  const avatars = useAppStore((s) => s.avatars);
  const groups = useAppStore((s) => s.groups);
  const addPane = useAppStore((s) => s.addPane);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);

  const resolveForwardTargetForFavorite = useCallback(
    async (payload: ForwardConfirmPayload): Promise<{ paneId: string; sessionId: string }> => {
      const state = useAppStore.getState();
      if (payload.type === "session") {
        const sid = payload.sessionId.trim();
        const p = state.panes.find((item) => (item.sessionId || "").trim() === sid);
        if (!p) {
          throw new Error("找不到对应窗格，请从侧栏重新打开该会话后再试");
        }
        return { paneId: p.id, sessionId: sid };
      }
      if (payload.type === "avatar") {
        let pane = state.panes.find((item) => item.avatarId === payload.avatarId);
        if (!pane) {
          const paneId = addPane(payload.avatarId, payload.displayName, "");
          setActiveAvatarId(payload.avatarId);
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(paneId, created.session_id);
          return { paneId, sessionId: created.session_id };
        }
        if (payload.forceNewSession) {
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(pane.id, created.session_id);
          setActivePaneId(pane.id);
          setActiveAvatarId(payload.avatarId);
          return { paneId: pane.id, sessionId: created.session_id };
        }
        let sid = (pane.sessionId || "").trim();
        if (!sid) {
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(pane.id, created.session_id);
          sid = created.session_id;
        }
        setActivePaneId(pane.id);
        setActiveAvatarId(payload.avatarId);
        return { paneId: pane.id, sessionId: sid };
      }
      const groupAvatarId = `group:${payload.groupId}`;
      let groupPane = state.panes.find((item) => item.avatarId === groupAvatarId);
      if (!groupPane) {
        const paneId = addPane(groupAvatarId, `群聊 · ${payload.displayName}`, "");
        setActiveAvatarId(null);
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(paneId, created.session_id);
        return { paneId, sessionId: created.session_id };
      }
      if (payload.forceNewSession) {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(groupPane.id, created.session_id);
        setActivePaneId(groupPane.id);
        setActiveAvatarId(null);
        return { paneId: groupPane.id, sessionId: created.session_id };
      }
      let sid = (groupPane.sessionId || "").trim();
      if (!sid) {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(groupPane.id, created.session_id);
        sid = created.session_id;
      }
      setActivePaneId(groupPane.id);
      setActiveAvatarId(null);
      return { paneId: groupPane.id, sessionId: sid };
    },
    [addPane, setActiveAvatarId, setActivePaneId, setPaneSessionId]
  );

  const handleForwardFavorite = useCallback(
    async (
      ctx: { sourceSessionId: string; content: string; role?: string },
      targetPayload: ForwardConfirmPayload,
      followUpNote: string
    ) => {
      const source = ctx.sourceSessionId.trim();
      if (!source) throw new Error("这条收藏缺少来源会话，无法转发");
      const base = apiBase.replace(/\/$/, "");
      if (!base) throw new Error("未连接 Studio");
      const follow = followUpNote.trim();
      const defaultForwardFollowCue = "请阅读刚转发的聊天记录并继续回复。";
      const effectiveFollowNote = follow || defaultForwardFollowCue;
      const rawRole = (ctx.role || "assistant").trim().toLowerCase();
      const roleForForward =
        rawRole === "user" ? "user" : rawRole === "tool" ? "tool" : "assistant";
      const sender =
        roleForForward === "user" ? "我" : roleForForward === "tool" ? "工具" : "AI";
      const { paneId: targetPaneId, sessionId: targetSessionId } =
        await resolveForwardTargetForFavorite(targetPayload);
      const resp = await fetch(`${base}/api/messages/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          source_session_id: source,
          target_session_id: targetSessionId,
          messages: [{ sender, role: roleForForward, content: ctx.content }],
          follow_up_note: effectiveFollowNote,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text.slice(0, 200) || `转发失败 HTTP ${resp.status}`);
      }
      setActivePaneId(targetPaneId);
      const targetPaneMeta = useAppStore.getState().panes.find((p) => p.id === targetPaneId);
      const aid = targetPaneMeta?.avatarId;
      if (aid?.startsWith("group:")) {
        setActiveAvatarId(null);
      } else {
        setActiveAvatarId(aid ?? null);
      }
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
        if (result.ok && Array.isArray(result.messages)) {
          const mapped: Message[] = result.messages.map((item, index) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, index)
          );
          setPaneMessages(targetPaneId, mapped);
        }
      } catch {
        // keep server state; pane may refresh on next poll
      }
      setForwardAutoReply({
        paneId: targetPaneId,
        sessionId: targetSessionId,
        text: effectiveFollowNote,
      });
      useAppStore.getState().bumpSessionCatalogRevision();
      window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
    },
    [
      apiBase,
      apiToken,
      resolveForwardTargetForFavorite,
      setActiveAvatarId,
      setActivePaneId,
      setForwardAutoReply,
      setPaneMessages,
    ]
  );

  useEffect(() => {
    const refreshSessionMessages = async (targetSessionId: string) => {
      const sid = String(targetSessionId ?? "").trim();
      if (!sid) return;
      const state = useAppStore.getState();
      const sameSid = state.panes.filter((pane) => String(pane.sessionId ?? "").trim() === sid);
      if (sameSid.length === 0) return;
      // 定时任务会话只应刷新 automation:* 窗格，避免与 Machi 窗格误绑同一 sessionId 时被错误覆盖
      const autoPanes = sameSid.filter((p) => String(p.avatarId ?? "").startsWith("automation:"));
      const targets = autoPanes.length > 0 ? autoPanes : sameSid;
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(sid);
        if (!result.ok || !Array.isArray(result.messages)) return;
        const mapped = result.messages.map((item, idx) =>
          mapLoadedSessionMessage(item as LoadedSessionMessage, sid, idx)
        );
        for (const pane of targets) {
          setPaneMessages(pane.id, mapped);
        }
      } catch {
        // keep current pane state; next poll may recover
      }
    };

    const ensureAutomationPane = (payload: {
      taskId: string;
      taskName: string;
      sessionId?: string;
    }): string | null => {
      const sid = String(payload.sessionId ?? "").trim();
      if (!sid) return null;
      const avatarId = `automation:${payload.taskId}`;
      const paneTitle = `定时 · ${payload.taskName || "自动化任务"}`;
      const state = useAppStore.getState();
      const existingByAvatar = state.panes.find((pane) => pane.avatarId === avatarId);
      if (existingByAvatar) {
        const prevSid = (existingByAvatar.sessionId || "").trim();
        if (prevSid !== sid) {
          // 新一轮触发切换到新 session：先清掉旧消息，避免视觉上「还在看旧聊天」。
          setPaneMessages(existingByAvatar.id, []);
          setPaneSessionId(existingByAvatar.id, sid);
        }
        return existingByAvatar.id;
      }
      // 必须与当前任务的 automation:<id> 一致，不能把 Machi/分身窗格当成定时窗格复用
      const existingBySession = state.panes.find(
        (pane) => (pane.sessionId || "").trim() === sid && pane.avatarId === avatarId
      );
      if (existingBySession) return existingBySession.id;
      const paneId = addPane(avatarId, paneTitle, sid);
      setPaneSessionId(paneId, sid);
      return paneId;
    };

    const startAutomationPoll = () => {
      if (automationPollTimerRef.current !== null) return;
      automationPollTimerRef.current = window.setInterval(() => {
        const runningSessions = Array.from(automationRunningRef.current.keys());
        if (runningSessions.length === 0) return;
        for (const sid of runningSessions) {
          void refreshSessionMessages(sid);
        }
      }, 1400);
    };

    const stopAutomationPollIfIdle = () => {
      if (automationRunningRef.current.size > 0) return;
      if (automationPollTimerRef.current !== null) {
        window.clearInterval(automationPollTimerRef.current);
        automationPollTimerRef.current = null;
      }
    };

    const off = window.agenticxDesktop.onAutomationTaskProgress((payload) => {
      const sid = String(payload.sessionId ?? "").trim();
      const paneId = ensureAutomationPane(payload);
      if (paneId) {
        setActivePaneId(paneId);
        const openedPane = useAppStore.getState().panes.find((pane) => pane.id === paneId);
        const aid = String(openedPane?.avatarId ?? "").trim();
        setActiveAvatarId(aid.startsWith("automation:") ? null : (openedPane?.avatarId ?? null));
      }
      if (!sid) return;
      const taskKey = String(payload.taskId ?? "").trim() || `ts:${Date.now()}`;
      if (payload.phase === "queued" || payload.phase === "running") {
        const runningSet = automationRunningRef.current.get(sid) ?? new Set<string>();
        runningSet.add(taskKey);
        automationRunningRef.current.set(sid, runningSet);
        startAutomationPoll();
        void refreshSessionMessages(sid);
        return;
      }
      const runningSet = automationRunningRef.current.get(sid);
      if (runningSet) {
        runningSet.delete(taskKey);
        if (runningSet.size === 0) {
          automationRunningRef.current.delete(sid);
        } else {
          automationRunningRef.current.set(sid, runningSet);
        }
      }
      void refreshSessionMessages(sid);
      stopAutomationPollIfIdle();
    });

    return () => {
      off();
      if (automationPollTimerRef.current !== null) {
        window.clearInterval(automationPollTimerRef.current);
        automationPollTimerRef.current = null;
      }
      automationRunningRef.current.clear();
    };
  }, [addPane, setActiveAvatarId, setActivePaneId, setPaneMessages, setPaneSessionId]);

  // Watch feishu_binding.json for _desktop key changes — auto-switch pane when /bind fires
  const feishuBindingSidRef = useRef<string>("");
  const feishuBindingHydratedRef = useRef(false);
  useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (!r.ok || cancelled) return;
        const desk = r.bindings["_desktop"] as { session_id?: string; avatar_id?: string; avatar_name?: string } | undefined;
        const newSid = (desk?.session_id ?? "").trim();
        const deskAvatar = (desk?.avatar_id ?? "").trim();
        if (newSid && deskAvatar.startsWith("automation:")) {
          void window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
          feishuBindingSidRef.current = "";
          feishuBindingHydratedRef.current = true;
          return;
        }

        const prevSid = feishuBindingSidRef.current;
        // Startup hydration: only sync baseline binding value.
        // Do not auto-switch pane on first successful read, so we keep
        // the last active pane/session restored from workspace snapshot.
        if (!feishuBindingHydratedRef.current) {
          feishuBindingSidRef.current = newSid;
          feishuBindingHydratedRef.current = true;
          return;
        }
        if (newSid === prevSid) return;
        feishuBindingSidRef.current = newSid;

        if (!newSid) {
          // _desktop was cleared (/unbind) — switch back to the Meta/Machi pane
          if (!prevSid) return; // was already unbound at startup, nothing to do
          const state = useAppStore.getState();
          // Prefer the pane whose session was previously bound (to deactivate it),
          // then fall back to the first pane with no avatarId (Meta/Machi),
          // then fall back to panes[0].
          const metaPane =
            state.panes.find((p) => !p.avatarId || p.avatarId === "") ??
            state.panes[0];
          if (metaPane) {
            setActivePaneId(metaPane.id);
            setActiveAvatarId(null);
          }
          return;
        }

        // New binding: find or create a pane for this session
        const state = useAppStore.getState();
        const existingPane = state.panes.find((p) => p.sessionId === newSid);
        if (existingPane) {
          setActivePaneId(existingPane.id);
          const aid = existingPane.avatarId;
          setActiveAvatarId(aid?.startsWith("group:") ? null : (aid ?? null));
        } else {
          const avatarId = (desk?.avatar_id ?? "").trim() || null;
          const rawName = (desk?.avatar_name ?? "").trim();
          // avatar_id 为空表示飞书默认路由到 Machi；勿用「分身」占位，否则顶栏/气泡会与元智能体不一致且无 meta 头像
          const avatarName = rawName || (avatarId ? "分身" : "Machi");
          const reusableMetaPane =
            !avatarId
              ? state.panes.find((pane) => !String(pane.avatarId ?? "").trim())
              : null;
          const paneId = reusableMetaPane
            ? reusableMetaPane.id
            : addPane(avatarId, avatarName, newSid);
          if (reusableMetaPane) {
            setPaneSessionId(reusableMetaPane.id, newSid);
            setPaneMessages(reusableMetaPane.id, []);
          }
          setActivePaneId(paneId);
          setActiveAvatarId(avatarId?.startsWith("group:") ? null : (avatarId ?? null));
          // Load messages for the new pane
          try {
            const msgs = await window.agenticxDesktop.loadSessionMessages(newSid);
            if (msgs.ok && Array.isArray(msgs.messages)) {
              const mapped = msgs.messages.map((item, idx) =>
                mapLoadedSessionMessage(item as LoadedSessionMessage, newSid, idx)
              );
              setPaneMessages(paneId, mapped);
            } else {
              setPaneMessages(paneId, []);
            }
          } catch {
            setPaneMessages(paneId, []);
          }
        }
      } catch {
        /* ignore */
      }
    };

    const timer = window.setInterval(() => void check(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiBase, addPane, setActivePaneId, setActiveAvatarId, setPaneMessages, setPaneSessionId]);

  return (
    <div
      className={`agx-app ${
        sidebarCollapsed || userMode !== "pro" || !apiBase ? "sidebar-collapsed" : ""
      } ${windowResizing ? "window-resizing" : ""} ${startupOptimizing ? "startup-optimizing" : ""}`}
    >
      {!configLoaded ? (
        <div className="flex h-full min-h-0 w-full items-center justify-center text-sm text-text-faint">
          正在加载配置…
        </div>
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
        sessionId={String((activePaneSessionId || sessionId || "").trim())}
        apiBase={apiBase}
        apiToken={apiToken}
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
        panes={panes}
        avatars={avatars}
        groups={groups}
        onForwardFavorite={handleForwardFavorite}
      />
    </div>
  );
}
