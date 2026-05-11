import { arrayMove } from "@dnd-kit/sortable";
import { create } from "zustand";
import { isSettingsTab } from "./settings-tab";
import type { SettingsTab } from "./settings-tab";
import { clearPaneAwaitingFreshSession } from "./utils/pane-fresh-session";

export type UiStatus = "idle" | "listening" | "processing";
export type MsgRole = "user" | "assistant" | "tool";
export type SubAgentStatus =
  | "pending"
  | "awaiting_confirm"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type ConfirmStrategy = "manual" | "semi-auto" | "auto";
export type ThemeMode = "dark" | "light" | "dim";
export type ChatStyle = "im" | "terminal" | "clean";
/** MCP 列表展示态（与 Studio `/api/mcp/servers` 对齐，近似 Cursor 绿/红/灰语义） */
export type McpServer = {
  name: string;
  connected: boolean;
  command?: string;
  /** healthy=握手且已注册工具；error=仍标记已连但当前无工具（多为子进程失效）；disconnected=未连 */
  connection_state?: "healthy" | "error" | "disconnected";
  tool_count?: number;
  /** Original tool names registered by this server (populated when connected & healthy). */
  tool_names?: string[];
  error_detail?: string;
  /** 最新运维状态：idle/preparing/connecting/healthy/failed/disconnecting */
  op_phase?: string;
  /** 每个 MCP 卡片底部展示的简短状态日志 */
  op_message?: string;
  op_updated_at?: number;
};

export type Avatar = {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  pinned: boolean;
  createdBy: string;
  systemPrompt?: string;
  toolsEnabled?: Record<string, boolean>;
  /** Per-skill overrides: false = disabled for this avatar; missing = inherit global. */
  skillsEnabled?: Record<string, boolean>;
  /** Default LLM provider the avatar uses when a session has no explicit model yet. */
  defaultProvider?: string;
  /** Default LLM model the avatar uses when a session has no explicit model yet. */
  defaultModel?: string;
};

export type SessionItem = {
  sessionId: string;
  avatarId: string | null;
  sessionName: string | null;
  updatedAt: number;
  createdAt?: number;
  pinned?: boolean;
  archived?: boolean;
  /** Last-used LLM provider/model for this session (empty = never picked). */
  provider?: string;
  model?: string;
};

export type Taskspace = {
  id: string;
  label: string;
  path: string;
};

export type GroupChat = {
  id: string;
  name: string;
  avatarIds: string[];
  routing: string;
};

export type SidePanelTab = "workspace" | "members";

export type PaneTerminalTab = {
  id: string;
  cwd: string;
  label: string;
  /** When set, embed PTY stream from local cc-bridge (visible_tui) instead of a local shell. */
  ccBridgePty?: {
    sessionId: string;
    baseUrl: string;
    token: string;
  };
};

export type ChatPane = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  modelProvider: string;
  modelName: string;
  messages: Message[];
  historyOpen: boolean;
  contextInherited: boolean;
  taskspacePanelOpen: boolean;
  membersPanelOpen: boolean;
  /** Legacy persisted field; no longer used for visibility control. */
  sidePanelTab: SidePanelTab;
  activeTaskspaceId: string | null;
  /** Right column: Spawns list (independent from workspace panel). */
  spawnsColumnOpen: boolean;
  /** After user closes Spawns column: suppress auto-open until a new sub-agent id appears. */
  spawnsColumnSuppressAuto: boolean;
  /** Sub-agent ids snapshot when user dismissed the column (for detecting "new spawn"). */
  spawnsColumnBaselineIds: string[];
  /** Embedded terminals in workspace panel (bottom). */
  terminalTabs: PaneTerminalTab[];
  activeTerminalTabId: string | null;
  /** Cumulative token usage for the current session (resets on new session). */
  sessionTokens: { input: number; output: number };
  /** Temporary highlight terms from session-history search navigation. */
  historySearchTerms: string[];
};

/** Lifecycle for merged tool_call + tool_result rows in chat (desktop Meta pane). */
export type ToolCallStatus = "pending" | "running" | "done" | "error" | "cancelled";

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
  timestamp?: number;
  agentId?: string;
  avatarName?: string;
  avatarUrl?: string;
  provider?: string;
  model?: string;
  quotedMessageId?: string;
  quotedContent?: string;
  forwardedHistory?: ForwardedHistoryCard;
  attachments?: MessageAttachment[];
  inlineConfirm?: PendingConfirm;
  /** Correlates tool_call / tool_result / tool_progress from runtime SSE (`tool_call_id`). */
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: ToolCallStatus;
  toolElapsedSec?: number;
  /** One-line preview for collapsed header while running or after done. */
  toolResultPreview?: string;
  /** Consecutive tool messages with the same id render inside one TurnToolGroupCard. */
  toolGroupId?: string;
  /** Live stdout/stderr lines for long-running tools (e.g. bash_exec). */
  toolStreamLines?: string[];
};

/** Extras allowed on tool messages from `addPaneMessage` / `addMessage`. */
export type MessageToolExtras = Pick<
  Message,
  | "toolCallId"
  | "toolName"
  | "toolArgs"
  | "toolStatus"
  | "toolElapsedSec"
  | "toolResultPreview"
  | "toolGroupId"
  | "toolStreamLines"
  | "inlineConfirm"
>;

export type ForwardedHistoryItem = {
  sender: string;
  role: string;
  content: string;
  avatarUrl?: string;
  timestamp?: number;
};

export type ForwardedHistoryCard = {
  title: string;
  sourceSession: string;
  note?: string;
  items: ForwardedHistoryItem[];
};

export type MessageAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  sourcePath?: string;
  referenceToken?: boolean;
};

export type QueuedMessage = {
  id: string;
  text: string;
  attachments: MessageAttachment[];
  contextFiles: MessageAttachment[];
  timestamp: number;
};

export type SubAgentEvent = {
  id: string;
  type: string;
  content: string;
  ts: number;
};

export type PendingConfirm = {
  requestId: string;
  question: string;
  agentId: string;
  sessionId: string;
  context?: Record<string, unknown>;
};

export type SubAgent = {
  id: string;
  name: string;
  role: string;
  provider?: string;
  model?: string;
  status: SubAgentStatus;
  task: string;
  sessionId?: string;
  progress?: number;
  currentAction?: string;
  liveOutput?: string;
  resultSummary?: string;
  outputFiles?: string[];
  pendingConfirm?: PendingConfirm;
  events: SubAgentEvent[];
};

type ConfirmState = {
  open: boolean;
  requestId: string;
  agentId: string;
  question: string;
  diff?: string;
  context?: Record<string, unknown>;
};

type FocusSnapshot = {
  sidebarCollapsed: boolean;
  panePanels: Record<
    string,
    {
      historyOpen: boolean;
      taskspacePanelOpen: boolean;
      membersPanelOpen: boolean;
      spawnsColumnOpen: boolean;
      spawnsColumnSuppressAuto: boolean;
      spawnsColumnBaselineIds: string[];
    }
  >;
};

export type ProviderEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
  /** Provider switch: false means hide all models for this provider in pickers. */
  enabled: boolean;
  /** When true, persist `drop_params` for LiteLLM (strip unsupported params like tool_choice on some gateways). */
  dropParams: boolean;
  /** 自定义服务厂商展示名 */
  displayName?: string;
  /** OpenAI 范式接口 */
  interface?: "openai";
};

type SettingsState = {
  open: boolean;
  /** 打开设置时若指定，则 SettingsPanel 会切换到对应分区并随后清空。 */
  openToTab?: SettingsTab;
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
  /** legacy compat */
  provider: string;
  model: string;
  apiKey: string;
};

export type TokenDashboardRange = "day" | "week" | "month" | "total" | "custom";

type TokenDashboardState = {
  open: boolean;
  range: TokenDashboardRange;
  customFrom: string;
  customTo: string;
};

type AppState = {
  apiBase: string;
  apiToken: string;
  sessionId: string;
  status: UiStatus;
  messages: Message[];
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  codePreview: string;
  confirm: ConfirmState;
  settings: SettingsState;
  tokenDashboard: TokenDashboardState;
  activeProvider: string;
  activeModel: string;
  userMode: "pro" | "lite";
  onboardingCompleted: boolean;
  commandPaletteOpen: boolean;
  keybindingsPanelOpen: boolean;
  planMode: boolean;
  sidebarCollapsed: boolean;
  focusMode: boolean;
  focusModeTall: boolean;
  focusSnapshot: FocusSnapshot | null;
  theme: ThemeMode;
  /** Machi 官网账号登录状态（与 AccountTab / Topbar 共享，首屏和事件回调同步）。 */
  agxAccount: { loggedIn: boolean; email: string; displayName: string };
  chatStyle: ChatStyle;
  /** Global user nickname shown on all bubbles and sent as context label (empty → 「我」). */
  userNickname: string;
  /** Custom avatar for current user. */
  userAvatarUrl: string;
  /** Free-text user preference/style injected into every agent system prompt. Max 500 chars. */
  userPreference: string;
  /** Custom avatar for Meta-Agent (Machi). */
  metaAvatarUrl: string;
  confirmStrategy: ConfirmStrategy;
  mcpServers: McpServer[];
  avatars: Avatar[];
  activeAvatarId: string | null;
  avatarSessions: SessionItem[];
  groups: GroupChat[];
  panes: ChatPane[];
  activePaneId: string;
  /** Incremented when local session list should refresh (e.g. new session created). SessionHistoryPanel subscribes. */
  sessionCatalogRevision: number;
  bumpSessionCatalogRevision: () => void;
  /** After merge-forward, target pane runs one normal /api/chat with this text (cleared when consumed). */
  forwardAutoReply: { paneId: string; sessionId: string; text: string } | null;
  setForwardAutoReply: (job: { paneId: string; sessionId: string; text: string } | null) => void;
  /** Per-pane queued user messages (sent automatically after current stream ends). */
  pendingMessages: Record<string, QueuedMessage[]>;
  enqueuePaneMessage: (paneId: string, msg: QueuedMessage) => void;
  dequeuePaneMessage: (paneId: string) => QueuedMessage | undefined;
  removePendingMessage: (paneId: string, msgId: string) => void;
  editPendingMessage: (paneId: string, msgId: string, newText: string) => void;
  clearPendingMessages: (paneId: string) => void;
  setApiBase: (base: string) => void;
  setApiToken: (token: string) => void;
  setSessionId: (id: string) => void;
  setStatus: (status: UiStatus) => void;
  setActiveModel: (provider: string, model: string) => void;
  setPaneModel: (paneId: string, provider: string, model: string) => void;
  setUserMode: (mode: "pro" | "lite") => void;
  setOnboardingCompleted: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setKeybindingsPanelOpen: (v: boolean) => void;
  setPlanMode: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  enterFocusMode: () => void;
  exitFocusMode: () => void;
  toggleFocusMode: () => void;
  setFocusModeTall: (v: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setAgxAccount: (acct: { loggedIn: boolean; email: string; displayName: string }) => void;
  setChatStyle: (style: ChatStyle) => void;
  setUserNickname: (name: string) => void;
  setUserAvatarUrl: (url: string) => void;
  setUserPreference: (pref: string) => void;
  setMetaAvatarUrl: (url: string) => void;
  setConfirmStrategy: (v: ConfirmStrategy) => void;
  setMcpServers: (servers: McpServer[]) => void;
  setAvatars: (avatars: Avatar[]) => void;
  setActiveAvatarId: (id: string | null) => void;
  setAvatarSessions: (sessions: SessionItem[]) => void;
  setGroups: (groups: GroupChat[]) => void;
  setActivePaneId: (id: string) => void;
  hydratePanes: (panes: ChatPane[], activePaneId: string) => void;
  addPane: (avatarId: string | null, avatarName: string, sessionId: string) => string;
  removePane: (paneId: string) => void;
  /** 删除定时任务后移除所有绑定该任务的窗格（avatarId 为 automation:<taskId>）。 */
  removePanesForAutomationTaskId: (taskId: string) => void;
  reorderPanes: (fromIndex: number, toIndex: number) => void;
  addPaneMessage: (
    paneId: string,
    role: MsgRole,
    content: string,
    agentId?: string,
    provider?: string,
    model?: string,
    attachments?: MessageAttachment[],
    extras?: Partial<
      Pick<
        Message,
        | "avatarName"
        | "avatarUrl"
        | "quotedMessageId"
        | "quotedContent"
        | "timestamp"
        | "forwardedHistory"
        | "inlineConfirm"
      >
    > &
      Partial<MessageToolExtras>
  ) => void;
  /** Merge fields into an existing pane `tool` message by `toolCallId`. */
  updatePaneMessageByToolCallId: (
    paneId: string,
    toolCallId: string,
    patch: Partial<
      Pick<Message, "content" | "toolStatus" | "toolElapsedSec" | "toolResultPreview" | "toolStreamLines" | "inlineConfirm">
    > & {
      appendStreamLine?: string;
    }
  ) => boolean;
  /** Lite / global `messages` list: merge tool rows by `toolCallId` (mirrors pane path). */
  updateMessageByToolCallId: (
    toolCallId: string,
    patch: Partial<
      Pick<Message, "content" | "toolStatus" | "toolElapsedSec" | "toolResultPreview" | "toolStreamLines" | "inlineConfirm">
    > & {
      appendStreamLine?: string;
    }
  ) => boolean;
  updateLastPaneMessage: (paneId: string, content: string) => void;
  clearPaneMessages: (paneId: string) => void;
  setPaneSessionId: (paneId: string, sessionId: string, modelHint?: { provider?: string; model?: string }) => void;
  setPaneMessages: (paneId: string, messages: Message[]) => void;
  setPaneHistorySearchTerms: (paneId: string, terms: string[]) => void;
  togglePaneHistory: (paneId: string) => void;
  /** @deprecated Prefer cycleSidePanel / openSidePanel */
  toggleTaskspacePanel: (paneId: string) => void;
  toggleMembersPanel: (paneId: string) => void;
  cycleSidePanel: (paneId: string, tab: SidePanelTab) => void;
  openSidePanel: (paneId: string, tab: SidePanelTab) => void;
  setActiveTaskspace: (paneId: string, taskspaceId: string | null) => void;
  setPaneContextInherited: (paneId: string, inherited: boolean) => void;
  setSpawnsColumnOpen: (paneId: string, open: boolean) => void;
  dismissSpawnsColumn: (paneId: string, baselineSubAgentIds: string[]) => void;
  clearSpawnsColumnSuppress: (paneId: string) => void;
  addPaneTerminalTab: (
    paneId: string,
    cwd: string,
    labelHint?: string,
    ccBridgePty?: PaneTerminalTab["ccBridgePty"]
  ) => void;
  removePaneTerminalTab: (paneId: string, tabId: string) => void;
  setActivePaneTerminalTab: (paneId: string, tabId: string | null) => void;
  accumulatePaneTokens: (paneId: string, input: number, output: number) => void;
  addMessage: (
    role: MsgRole,
    content: string,
    agentId?: string,
    provider?: string,
    model?: string,
    attachments?: MessageAttachment[],
    extras?: Partial<
      Pick<
        Message,
        | "avatarName"
        | "avatarUrl"
        | "quotedMessageId"
        | "quotedContent"
        | "timestamp"
        | "forwardedHistory"
        | "inlineConfirm"
      >
    > &
      Partial<MessageToolExtras>
  ) => void;
  insertMessageAfter: (afterId: string, msg: Omit<Message, "id">) => string;
  clearMessages: () => void;
  addSubAgent: (item: Pick<SubAgent, "id" | "name" | "role" | "task" | "provider" | "model"> & { sessionId?: string }) => void;
  updateSubAgent: (id: string, patch: Partial<SubAgent>) => void;
  addSubAgentEvent: (id: string, event: Omit<SubAgentEvent, "id" | "ts">) => void;
  removeSubAgent: (id: string) => void;
  setSelectedSubAgent: (id: string | null) => void;
  setCodePreview: (code: string) => void;
  openConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => void;
  closeConfirm: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  updateSettings: (
    patch: Partial<
      Pick<
        SettingsState,
        "provider" | "model" | "apiKey" | "defaultProvider" | "providers" | "openToTab"
      >
    >
  ) => void;
  openTokenDashboard: () => void;
  closeTokenDashboard: () => void;
  setTokenDashboardRange: (range: TokenDashboardRange) => void;
  setTokenDashboardCustomRange: (from: string, to: string) => void;
};

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeDefaultPane(): ChatPane {
  return {
    id: "pane-meta",
    avatarId: null,
    avatarName: "Machi",
    sessionId: "",
    modelProvider: "",
    modelName: "",
    messages: [],
    historyOpen: false,
    contextInherited: false,
    taskspacePanelOpen: false,
    membersPanelOpen: false,
    sidePanelTab: "workspace",
    activeTaskspaceId: null,
    spawnsColumnOpen: false,
    spawnsColumnSuppressAuto: false,
    spawnsColumnBaselineIds: [],
    terminalTabs: [],
    activeTerminalTabId: null,
    sessionTokens: { input: 0, output: 0 },
    historySearchTerms: [],
  };
}

const CHAT_STYLE_STORAGE_KEY = "agx-chat-style";
const USER_DISPLAY_NAME_KEY = "agx-user-display-name";
const USER_PREFERENCE_KEY = "agx-user-preference";
const USER_AVATAR_URL_KEY = "agx-user-avatar-url";
const META_AVATAR_URL_KEY = "agx-meta-avatar-url";
const SESSION_TOKEN_CACHE_KEY = "agx-session-token-cache-v1";

function loadChatStyle(): ChatStyle {
  try {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") return saved;
  } catch {
    // ignore storage errors
  }
  return "im";
}

function loadUserNickname(): string {
  try {
    const saved = window.localStorage.getItem(USER_DISPLAY_NAME_KEY);
    if (typeof saved === "string") return saved.slice(0, 48);
  } catch {
    // ignore storage errors
  }
  return "";
}

function loadUserPreference(): string {
  try {
    const saved = window.localStorage.getItem(USER_PREFERENCE_KEY);
    if (typeof saved === "string") return saved.slice(0, 500);
  } catch {
    // ignore storage errors
  }
  return "";
}

function loadUserAvatarUrl(): string {
  try {
    const saved = window.localStorage.getItem(USER_AVATAR_URL_KEY);
    if (typeof saved === "string") return saved;
  } catch {
    // ignore storage errors
  }
  return "";
}

function loadMetaAvatarUrl(): string {
  try {
    const saved = window.localStorage.getItem(META_AVATAR_URL_KEY);
    if (typeof saved === "string") return saved;
  } catch {
    // ignore storage errors
  }
  return "";
}

type SessionTokenCache = Record<string, { input: number; output: number; updatedAt: number }>;

function toNonNegativeInt(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function readSessionTokenCache(): SessionTokenCache {
  try {
    const raw = window.localStorage.getItem(SESSION_TOKEN_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: SessionTokenCache = {};
    for (const [sid, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!sid || !value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      out[sid] = {
        input: toNonNegativeInt(row.input),
        output: toNonNegativeInt(row.output),
        updatedAt: toNonNegativeInt(row.updatedAt) || Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeSessionTokenCache(cache: SessionTokenCache): void {
  try {
    const entries = Object.entries(cache).sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    const trimmed = entries.slice(0, 500);
    const normalized: SessionTokenCache = {};
    for (const [sid, row] of trimmed) normalized[sid] = row;
    window.localStorage.setItem(SESSION_TOKEN_CACHE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage errors
  }
}

function getSessionTokensFromCache(sessionId: string): { input: number; output: number } | null {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const row = readSessionTokenCache()[sid];
  if (!row) return null;
  return { input: toNonNegativeInt(row.input), output: toNonNegativeInt(row.output) };
}

function upsertSessionTokenCache(sessionId: string, input: number, output: number): void {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return;
  const cache = readSessionTokenCache();
  cache[sid] = {
    input: toNonNegativeInt(input),
    output: toNonNegativeInt(output),
    updatedAt: Date.now(),
  };
  writeSessionTokenCache(cache);
}

export const useAppStore = create<AppState>((set, get) => ({
  apiBase: "",
  apiToken: "",
  sessionId: "",
  status: "idle",
  messages: [],
  activeProvider: "",
  activeModel: "",
  userMode: "pro",
  onboardingCompleted: true,
  commandPaletteOpen: false,
  keybindingsPanelOpen: false,
  planMode: false,
  sidebarCollapsed: false,
  focusMode: false,
  focusModeTall: false,
  focusSnapshot: null,
  theme: "dark",
  agxAccount: { loggedIn: false, email: "", displayName: "" },
  chatStyle: loadChatStyle(),
  userNickname: loadUserNickname(),
  userAvatarUrl: loadUserAvatarUrl(),
  userPreference: loadUserPreference(),
  metaAvatarUrl: loadMetaAvatarUrl(),
  confirmStrategy: "semi-auto",
  mcpServers: [],
  avatars: [],
  activeAvatarId: null,
  avatarSessions: [],
  groups: [],
  panes: [makeDefaultPane()],
  activePaneId: "pane-meta",
  sessionCatalogRevision: 0,
  bumpSessionCatalogRevision: () =>
    set((state) => ({ sessionCatalogRevision: state.sessionCatalogRevision + 1 })),
  forwardAutoReply: null,
  subAgents: [],
  selectedSubAgent: null,
  codePreview: "",
  confirm: { open: false, requestId: "", question: "", agentId: "meta" },
  settings: { open: false, provider: "", model: "", apiKey: "", defaultProvider: "", providers: {} },
  tokenDashboard: { open: false, range: "month", customFrom: "", customTo: "" },
  setApiBase: (apiBase) => set({ apiBase }),
  setApiToken: (apiToken) => set({ apiToken }),
  setSessionId: (sessionId) => set({ sessionId }),
  setStatus: (status) => set({ status }),
  setActiveModel: (activeProvider, activeModel) => set({ activeProvider, activeModel }),
  setPaneModel: (paneId, provider, model) =>
    set((state) => {
      const nextProvider = String(provider ?? "").trim();
      const nextModel = String(model ?? "").trim();
      const paneExists = state.panes.some((pane) => pane.id === paneId);
      if (!paneExists) return state;
      const nextPanes = state.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, modelProvider: nextProvider, modelName: nextModel }
          : pane
      );
      if (state.activePaneId !== paneId) {
        return { panes: nextPanes };
      }
      return {
        panes: nextPanes,
        activeProvider: nextProvider,
        activeModel: nextModel,
      };
    }),
  setUserMode: (userMode) => set({ userMode }),
  setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setKeybindingsPanelOpen: (keybindingsPanelOpen) => set({ keybindingsPanelOpen }),
  setPlanMode: (planMode) => set({ planMode }),
  setSidebarCollapsed: (next) =>
    set((state) => ({
      sidebarCollapsed:
        typeof next === "function" ? next(state.sidebarCollapsed) : next,
    })),
  setFocusModeTall: (v) => set({ focusModeTall: v }),
  enterFocusMode: () => {
    const already = get().focusMode;
    set((state) => {
      if (state.focusMode) return state;
      const panePanels: FocusSnapshot["panePanels"] = {};
      for (const pane of state.panes) {
        panePanels[pane.id] = {
          historyOpen: pane.historyOpen,
          taskspacePanelOpen: pane.taskspacePanelOpen,
          membersPanelOpen: pane.membersPanelOpen,
          spawnsColumnOpen: pane.spawnsColumnOpen,
          spawnsColumnSuppressAuto: pane.spawnsColumnSuppressAuto,
          spawnsColumnBaselineIds: [...(pane.spawnsColumnBaselineIds ?? [])],
        };
      }
      return {
        focusMode: true,
        focusModeTall: false,
        focusSnapshot: {
          sidebarCollapsed: state.sidebarCollapsed,
          panePanels,
        },
        sidebarCollapsed: true,
        panes: state.panes.map((pane) => ({
          ...pane,
          historyOpen: false,
          taskspacePanelOpen: false,
          membersPanelOpen: false,
          spawnsColumnOpen: false,
        })),
      };
    });
    if (!already) {
      // Fire-and-forget: shrink the actual Electron window to a compact
      // capsule. Older preload builds may not expose this IPC — in that case
      // we silently fall back to in-renderer layout only.
      try {
        void window.agenticxDesktop?.focusModeEnter?.();
      } catch {
        // ignore IPC errors; UI-only focus mode still works
      }
    }
  },
  exitFocusMode: () => {
    const wasActive = get().focusMode;
    set((state) => {
      if (!state.focusMode) return state;
      const snapshot = state.focusSnapshot;
      if (!snapshot) {
        return { focusMode: false, focusModeTall: false, focusSnapshot: null };
      }
      return {
        focusMode: false,
        focusModeTall: false,
        focusSnapshot: null,
        sidebarCollapsed: snapshot.sidebarCollapsed,
        panes: state.panes.map((pane) => {
          const paneSnapshot = snapshot.panePanels[pane.id];
          if (!paneSnapshot) return pane;
          return {
            ...pane,
            historyOpen: paneSnapshot.historyOpen,
            taskspacePanelOpen: paneSnapshot.taskspacePanelOpen,
            membersPanelOpen: paneSnapshot.membersPanelOpen,
            spawnsColumnOpen: paneSnapshot.spawnsColumnOpen,
            spawnsColumnSuppressAuto: paneSnapshot.spawnsColumnSuppressAuto,
            spawnsColumnBaselineIds: [...paneSnapshot.spawnsColumnBaselineIds],
          };
        }),
      };
    });
    if (wasActive) {
      try {
        void window.agenticxDesktop?.focusModeExit?.();
      } catch {
        // ignore IPC errors; window will stay at current size
      }
    }
  },
  toggleFocusMode: () => {
    const state = get();
    if (state.focusMode) {
      state.exitFocusMode();
      return;
    }
    state.enterFocusMode();
  },
  setTheme: (theme) => set({ theme }),
  setAgxAccount: (agxAccount) => set({ agxAccount }),
  setChatStyle: (chatStyle) =>
    set(() => {
      try {
        window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, chatStyle);
      } catch {
        // ignore storage errors
      }
      return { chatStyle };
    }),
  setUserNickname: (name) =>
    set(() => {
      const next = String(name ?? "").slice(0, 48);
      try {
        if (next.trim()) window.localStorage.setItem(USER_DISPLAY_NAME_KEY, next);
        else window.localStorage.removeItem(USER_DISPLAY_NAME_KEY);
      } catch {
        // ignore storage errors
      }
      return { userNickname: next };
    }),
  setUserAvatarUrl: (url) =>
    set(() => {
      const next = String(url ?? "");
      try {
        if (next.trim()) window.localStorage.setItem(USER_AVATAR_URL_KEY, next);
        else window.localStorage.removeItem(USER_AVATAR_URL_KEY);
      } catch {
        // ignore storage errors
      }
      return { userAvatarUrl: next };
    }),
  setUserPreference: (pref) =>
    set(() => {
      const next = String(pref ?? "").slice(0, 500);
      try {
        if (next.trim()) window.localStorage.setItem(USER_PREFERENCE_KEY, next);
        else window.localStorage.removeItem(USER_PREFERENCE_KEY);
      } catch {
        // ignore storage errors
      }
      return { userPreference: next };
    }),
  setMetaAvatarUrl: (url) =>
    set(() => {
      const next = String(url ?? "");
      try {
        if (next.trim()) window.localStorage.setItem(META_AVATAR_URL_KEY, next);
        else window.localStorage.removeItem(META_AVATAR_URL_KEY);
      } catch {
        // ignore storage errors
      }
      return { metaAvatarUrl: next };
    }),
  setConfirmStrategy: (confirmStrategy) => set({ confirmStrategy }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setAvatars: (avatars) => set({ avatars }),
  setActiveAvatarId: (activeAvatarId) => set({ activeAvatarId }),
  setAvatarSessions: (avatarSessions) => set({ avatarSessions }),
  setGroups: (groups) => set({ groups }),
  setActivePaneId: (activePaneId) =>
    set((state) => {
      const target = state.panes.find((pane) => pane.id === activePaneId);
      if (!target) return state;
      let provider = (target.modelProvider || "").trim();
      let model = (target.modelName || "").trim();
      if (!provider || !model) {
        const avatar = target.avatarId
          ? state.avatars.find((a) => a.id === target.avatarId)
          : null;
        const avatarProvider = (avatar?.defaultProvider || "").trim();
        const avatarModel = (avatar?.defaultModel || "").trim();
        const defaultProvider = (state.settings.defaultProvider || "").trim();
        const defaultModel = (state.settings.providers[defaultProvider]?.model || "").trim();
        if (avatarProvider && avatarModel) {
          provider = avatarProvider;
          model = avatarModel;
        } else if (defaultProvider && defaultModel) {
          provider = defaultProvider;
          model = defaultModel;
        }
        if (provider && model) {
          return {
            activePaneId,
            activeProvider: provider,
            activeModel: model,
            panes: state.panes.map((pane) =>
              pane.id === activePaneId
                ? { ...pane, modelProvider: provider, modelName: model }
                : pane
            ),
          };
        }
        return { activePaneId };
      }
      return {
        activePaneId,
        activeProvider: provider,
        activeModel: model,
      };
    }),
  hydratePanes: (panes, activePaneId) =>
    set((state) => {
      if (!Array.isArray(panes) || panes.length === 0) return state;
      const nextPanes = panes.map((p) => ({ ...makeDefaultPane(), ...p }));
      const hasActive = nextPanes.some((p) => p.id === activePaneId);
      const nextActiveId = hasActive ? activePaneId : nextPanes[0]?.id ?? state.activePaneId;
      const active = nextPanes.find((p) => p.id === nextActiveId) ?? nextPanes[0];
      return {
        panes: nextPanes,
        activePaneId: nextActiveId,
        activeProvider: (active?.modelProvider || "").trim(),
        activeModel: (active?.modelName || "").trim(),
      };
    }),
  setForwardAutoReply: (forwardAutoReply) => set({ forwardAutoReply }),
  pendingMessages: {},
  enqueuePaneMessage: (paneId, msg) =>
    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [paneId]: [...(state.pendingMessages[paneId] ?? []), msg],
      },
    })),
  dequeuePaneMessage: (paneId) => {
    const queue = get().pendingMessages[paneId];
    if (!queue?.length) return undefined;
    const first = queue[0];
    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [paneId]: (state.pendingMessages[paneId] ?? []).slice(1),
      },
    }));
    return first;
  },
  removePendingMessage: (paneId, msgId) =>
    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [paneId]: (state.pendingMessages[paneId] ?? []).filter((m) => m.id !== msgId),
      },
    })),
  editPendingMessage: (paneId, msgId, newText) =>
    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [paneId]: (state.pendingMessages[paneId] ?? []).map((m) =>
          m.id === msgId ? { ...m, text: newText } : m
        ),
      },
    })),
  clearPendingMessages: (paneId) =>
    set((state) => ({
      pendingMessages: {
        ...state.pendingMessages,
        [paneId]: [],
      },
    })),
  addPane: (avatarId, avatarName, sessionId) => {
    const paneId = uid();
    set((state) => ({
      // New pane should prefer avatar defaults so "click avatar" does not
      // inherit a random model from the currently active pane.
      panes: [
        ...state.panes,
        {
          id: paneId,
          avatarId,
          avatarName,
          sessionId,
          modelProvider: (() => {
            const av = avatarId ? state.avatars.find((a) => a.id === avatarId) : null;
            return (av?.defaultProvider || "").trim() || state.activeProvider;
          })(),
          modelName: (() => {
            const av = avatarId ? state.avatars.find((a) => a.id === avatarId) : null;
            return (av?.defaultModel || "").trim() || state.activeModel;
          })(),
          messages: [],
          historyOpen: false,
          contextInherited: false,
          taskspacePanelOpen: false,
          membersPanelOpen: false,
          sidePanelTab: "workspace",
          activeTaskspaceId: null,
          spawnsColumnOpen: false,
          spawnsColumnSuppressAuto: false,
          spawnsColumnBaselineIds: [],
          terminalTabs: [],
          activeTerminalTabId: null,
          sessionTokens: { input: 0, output: 0 },
          historySearchTerms: [],
        },
      ],
      activePaneId: paneId,
    }));
    return paneId;
  },
  removePane: (paneId) =>
    set((state) => {
      if (state.panes.length <= 1) return state;
      const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
      if (nextPanes.length === state.panes.length) return state;
      const nextActive =
        state.activePaneId === paneId
          ? nextPanes[Math.max(0, nextPanes.length - 1)]?.id ?? nextPanes[0].id
          : state.activePaneId;
      const activePane = nextPanes.find((pane) => pane.id === nextActive) ?? nextPanes[0];
      const provider = (activePane?.modelProvider || "").trim();
      const model = (activePane?.modelName || "").trim();
      return {
        panes: nextPanes,
        activePaneId: nextActive,
        ...(provider && model
          ? { activeProvider: provider, activeModel: model }
          : {}),
      };
    }),
  removePanesForAutomationTaskId: (taskId) =>
    set((state) => {
      const tid = String(taskId ?? "").trim();
      if (!tid) return state;
      const aid = `automation:${tid}`;
      const nextPanes = state.panes.filter((p) => p.avatarId !== aid);
      if (nextPanes.length === state.panes.length) return state;
      if (nextPanes.length === 0) {
        const fresh = makeDefaultPane();
        return {
          panes: [fresh],
          activePaneId: fresh.id,
          activeAvatarId: null,
        };
      }
      const removedActive = !nextPanes.some((p) => p.id === state.activePaneId);
      const nextActive = removedActive
        ? (nextPanes[nextPanes.length - 1]?.id ?? nextPanes[0].id)
        : state.activePaneId;
      const activePane = nextPanes.find((p) => p.id === nextActive) ?? nextPanes[0];
      const provider = (activePane?.modelProvider || "").trim();
      const model = (activePane?.modelName || "").trim();
      const nextAv = activePane?.avatarId ?? null;
      const activeAvatarId =
        nextAv &&
        !String(nextAv).startsWith("automation:") &&
        !String(nextAv).startsWith("group:")
          ? String(nextAv)
          : null;
      return {
        panes: nextPanes,
        activePaneId: nextActive,
        activeAvatarId,
        ...(provider && model ? { activeProvider: provider, activeModel: model } : {}),
      };
    }),
  reorderPanes: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return state;
      const n = state.panes.length;
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return state;
      return { panes: arrayMove(state.panes, fromIndex, toIndex) };
    }),
  addPaneMessage: (paneId, role, content, agentId, provider, model, attachments, extras) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              messages: [
                ...pane.messages,
                { id: uid(), role, content, timestamp: Date.now(), agentId, provider, model, attachments, ...extras },
              ],
            }
          : pane
      ),
    })),
  updatePaneMessageByToolCallId: (paneId, toolCallId, patch) => {
    let found = false;
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const idx = pane.messages.findIndex(
          (m) => m.role === "tool" && m.toolCallId === toolCallId
        );
        if (idx < 0) return pane;
        found = true;
        const msgs = [...pane.messages];
        const prev = msgs[idx];
        const { appendStreamLine, ...rest } = patch;
        let nextStream = prev.toolStreamLines;
        if (appendStreamLine !== undefined && appendStreamLine !== "") {
          nextStream = [...(prev.toolStreamLines ?? []), appendStreamLine].slice(-200);
        } else if (rest.toolStreamLines !== undefined) {
          nextStream = rest.toolStreamLines;
        }
        msgs[idx] = {
          ...prev,
          ...rest,
          ...(nextStream !== undefined ? { toolStreamLines: nextStream } : {}),
        };
        return { ...pane, messages: msgs };
      }),
    }));
    return found;
  },
  updateMessageByToolCallId: (toolCallId, patch) => {
    let found = false;
    set((state) => {
      const idx = state.messages.findIndex((m) => m.role === "tool" && m.toolCallId === toolCallId);
      if (idx < 0) return state;
      found = true;
      const prev = state.messages[idx];
      const { appendStreamLine, ...rest } = patch;
      let nextStream = prev.toolStreamLines;
      if (appendStreamLine !== undefined && appendStreamLine !== "") {
        nextStream = [...(prev.toolStreamLines ?? []), appendStreamLine].slice(-200);
      } else if (rest.toolStreamLines !== undefined) {
        nextStream = rest.toolStreamLines;
      }
      const updated: Message = {
        ...prev,
        ...rest,
        ...(nextStream !== undefined ? { toolStreamLines: nextStream } : {}),
      };
      const messages = [...state.messages];
      messages[idx] = updated;
      const msgId = updated.id;
      return {
        messages,
        panes: state.panes.map((pane) => {
          const pi = pane.messages.findIndex((m) => m.id === msgId);
          if (pi < 0) return pane;
          const pm = [...pane.messages];
          pm[pi] = updated;
          return { ...pane, messages: pm };
        }),
      };
    });
    return found;
  },
  updateLastPaneMessage: (paneId, content) =>
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        if (pane.messages.length === 0) return pane;
        const msgs = [...pane.messages];
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
        return { ...pane, messages: msgs };
      }),
    })),
  clearPaneMessages: (paneId) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, messages: [], sessionTokens: { input: 0, output: 0 } } : pane
      ),
    })),
  accumulatePaneTokens: (paneId, input, output) =>
    set((state) => {
      let targetSessionId = "";
      let nextInput = 0;
      let nextOutput = 0;
      const nextPanes = state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const merged = {
          input: (pane.sessionTokens?.input ?? 0) + input,
          output: (pane.sessionTokens?.output ?? 0) + output,
        };
        targetSessionId = String(pane.sessionId ?? "").trim();
        nextInput = merged.input;
        nextOutput = merged.output;
        return { ...pane, sessionTokens: merged };
      });
      if (targetSessionId) {
        upsertSessionTokenCache(targetSessionId, nextInput, nextOutput);
      }
      return { panes: nextPanes };
    }),
  setPaneSessionId: (paneId, sessionId, modelHint) => {
    // Any time the pane gets bound to a real session id, the "awaiting fresh
    // session" intent is satisfied — clear the flag so subsequent auto-
    // restore effects behave normally again.
    if (String(sessionId ?? "").trim()) {
      clearPaneAwaitingFreshSession(paneId);
    }
    const hintProvider = String(modelHint?.provider ?? "").trim();
    const hintModel = String(modelHint?.model ?? "").trim();
    set((state) => {
      // Priority chain when binding a session to a pane:
      //   modelHint (usually = session.provider/model from backend)
      //   > avatar.defaultProvider/defaultModel
      //   > settings.defaultProvider + providers[default].model
      // Leave empty strings alone so UI can still show "未选模型" if nothing
      // is configured anywhere — but only for explicit empty hint cases.
      const pane = state.panes.find((p) => p.id === paneId);
      let resolvedProvider = hintProvider;
      let resolvedModel = hintModel;
      if (!resolvedProvider || !resolvedModel) {
        const avatar = pane?.avatarId
          ? state.avatars.find((a) => a.id === pane.avatarId)
          : null;
        const avatarProvider = (avatar?.defaultProvider || "").trim();
        const avatarModel = (avatar?.defaultModel || "").trim();
        if (avatarProvider && avatarModel) {
          resolvedProvider = avatarProvider;
          resolvedModel = avatarModel;
        } else {
          const dp = (state.settings.defaultProvider || "").trim();
          const dm = (state.settings.providers[dp]?.model || "").trim();
          if (dp && dm) {
            resolvedProvider = dp;
            resolvedModel = dm;
          }
        }
      }
      const isActive = state.activePaneId === paneId;
      const nextPanes = state.panes.map((p) => {
        if (p.id !== paneId) return p;
        const cached = getSessionTokensFromCache(sessionId);
        const baseTokens =
          cached
            ? cached
            : String(p.sessionId ?? "").trim() === String(sessionId ?? "").trim()
              ? p.sessionTokens ?? { input: 0, output: 0 }
              : { input: 0, output: 0 };
        return {
          ...p,
          sessionId,
          sessionTokens: baseTokens,
          ...(resolvedProvider && resolvedModel
            ? { modelProvider: resolvedProvider, modelName: resolvedModel }
            : {}),
        };
      });
      const next: Partial<AppState> = { panes: nextPanes };
      if (isActive && resolvedProvider && resolvedModel) {
        next.activeProvider = resolvedProvider;
        next.activeModel = resolvedModel;
      }
      return next as AppState;
    });
  },
  setPaneMessages: (paneId, messages) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, messages } : pane)),
    })),
  setPaneHistorySearchTerms: (paneId, terms) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              historySearchTerms: Array.from(
                new Set(
                  (terms ?? [])
                    .map((t) => String(t ?? "").trim())
                    .filter((t) => t.length > 0)
                )
              ),
            }
          : pane
      ),
    })),
  togglePaneHistory: (paneId) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) =>
          pane.id === paneId ? { ...pane, historyOpen: !pane.historyOpen } : pane
        ),
      };
    }),
  cycleSidePanel: (paneId, tab) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) => {
          if (pane.id !== paneId) return pane;
          if (tab === "workspace") {
            return { ...pane, taskspacePanelOpen: !pane.taskspacePanelOpen, sidePanelTab: "workspace" };
          }
          return { ...pane, membersPanelOpen: !pane.membersPanelOpen, sidePanelTab: "members" };
        }),
      };
    }),
  openSidePanel: (paneId, tab) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? tab === "workspace"
              ? { ...pane, taskspacePanelOpen: true, sidePanelTab: "workspace" }
              : { ...pane, membersPanelOpen: true, sidePanelTab: "members" }
            : pane
        ),
      };
    }),
  toggleTaskspacePanel: (paneId) => {
    get().cycleSidePanel(paneId, "workspace");
  },
  toggleMembersPanel: (paneId) => {
    get().cycleSidePanel(paneId, "members");
  },
  setActiveTaskspace: (paneId, taskspaceId) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, activeTaskspaceId: taskspaceId } : pane
      ),
    })),
  setPaneContextInherited: (paneId, inherited) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, contextInherited: inherited } : pane)),
    })),
  setSpawnsColumnOpen: (paneId, open) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                spawnsColumnOpen: open,
                ...(open ? { spawnsColumnSuppressAuto: false, spawnsColumnBaselineIds: [] } : {}),
              }
            : pane
        ),
      };
    }),
  dismissSpawnsColumn: (paneId, baselineSubAgentIds) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                spawnsColumnOpen: false,
                spawnsColumnSuppressAuto: true,
                spawnsColumnBaselineIds: [...baselineSubAgentIds],
              }
            : pane
        ),
      };
    }),
  clearSpawnsColumnSuppress: (paneId) =>
    set((state) => {
      if (state.focusMode) return state;
      return {
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? { ...pane, spawnsColumnSuppressAuto: false, spawnsColumnBaselineIds: [] }
            : pane
        ),
      };
    }),
  addPaneTerminalTab: (paneId, cwd, labelHint, ccBridgePty) =>
    set((state) => {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return state;
      const trimmed = (cwd || "").trim();
      if (!trimmed) return state;
      const baseRaw = (labelHint ?? "").trim() || trimmed.split(/[/\\]/).filter(Boolean).pop() || "terminal";
      const sameCwd = pane.terminalTabs.filter((t) => t.cwd === trimmed).length;
      const label = sameCwd === 0 ? baseRaw : `${baseRaw} (#${sameCwd + 1})`;
      const id = uid();
      const tab: PaneTerminalTab = ccBridgePty
        ? { id, cwd: trimmed, label, ccBridgePty }
        : { id, cwd: trimmed, label };
      return {
        panes: state.panes.map((p) =>
          p.id === paneId
            ? {
                ...p,
                terminalTabs: [...p.terminalTabs, tab],
                activeTerminalTabId: id,
              }
            : p
        ),
      };
    }),
  removePaneTerminalTab: (paneId, tabId) =>
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const nextTabs = pane.terminalTabs.filter((t) => t.id !== tabId);
        let nextActive = pane.activeTerminalTabId;
        if (nextActive === tabId) {
          nextActive = nextTabs[nextTabs.length - 1]?.id ?? null;
        }
        return { ...pane, terminalTabs: nextTabs, activeTerminalTabId: nextActive };
      }),
    })),
  setActivePaneTerminalTab: (paneId, tabId) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, activeTerminalTabId: tabId } : pane
      ),
    })),
  addMessage: (role, content, agentId, provider, model, attachments, extras) =>
    set((state) => {
      const nextMessage: Message = {
        id: uid(),
        role,
        content,
        timestamp: Date.now(),
        agentId,
        provider,
        model,
        attachments,
        ...extras,
      };
      return {
        messages: [...state.messages, nextMessage],
        panes: state.panes.map((pane) =>
          pane.id === state.activePaneId ? { ...pane, messages: [...pane.messages, nextMessage] } : pane
        ),
      };
    }),
  insertMessageAfter: (afterId, msg) => {
    const newId = uid();
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === afterId);
      const insertAt = idx >= 0 ? idx + 1 : state.messages.length;
      const next = [...state.messages];
      next.splice(insertAt, 0, { ...msg, id: newId });
      const activePane = state.panes.find((pane) => pane.id === state.activePaneId);
      const paneMessages = activePane?.messages ?? [];
      const paneIdx = paneMessages.findIndex((m) => m.id === afterId);
      const paneInsertAt = paneIdx >= 0 ? paneIdx + 1 : paneMessages.length;
      const nextPaneMessages = [...paneMessages];
      nextPaneMessages.splice(paneInsertAt, 0, { ...msg, id: newId });
      return {
        messages: next,
        panes: state.panes.map((pane) =>
          pane.id === state.activePaneId ? { ...pane, messages: nextPaneMessages } : pane
        ),
      };
    });
    return newId;
  },
  clearMessages: () =>
    set((state) => ({
      messages: [],
      panes: state.panes.map((pane) =>
        pane.id === state.activePaneId ? { ...pane, messages: [] } : pane
      ),
    })),
  addSubAgent: (item) =>
    set((state) => {
      const exists = state.subAgents.some((sub) => sub.id === item.id);
      if (exists) {
        console.debug("[store] addSubAgent SKIP (dup)", item.id, "existing:", state.subAgents.length);
        return state;
      }
      const next: SubAgent = {
        ...item,
        status: "running",
        liveOutput: "",
        resultSummary: "",
        outputFiles: [],
        events: []
      };
      console.debug("[store] addSubAgent OK", item.id, item.name, "sid:", item.sessionId, "total:", state.subAgents.length + 1);
      return { subAgents: [...state.subAgents, next] };
    }),
  updateSubAgent: (id, patch) =>
    set((state) => ({
      subAgents: state.subAgents.map((item) => (item.id === id ? { ...item, ...patch } : item))
    })),
  addSubAgentEvent: (id, event) =>
    set((state) => ({
      subAgents: state.subAgents.map((item) => {
        if (item.id !== id) return item;
        const recent = item.events.slice(-30);
        const isDup = recent.some(
          (e) => e.type === event.type && e.content === event.content
        );
        if (isDup) return item;
        return {
          ...item,
          events: [
            ...item.events,
            { id: uid(), ts: Date.now(), type: event.type, content: event.content }
          ].slice(-100)
        };
      })
    })),
  removeSubAgent: (id) =>
    set((state) => ({
      subAgents: state.subAgents.filter((item) => item.id !== id),
      selectedSubAgent: state.selectedSubAgent === id ? null : state.selectedSubAgent
    })),
  setSelectedSubAgent: (selectedSubAgent) => set({ selectedSubAgent }),
  setCodePreview: (codePreview) => set({ codePreview }),
  openConfirm: (requestId, question, diff, agentId, context) =>
    set({ confirm: { open: true, requestId, question, diff, agentId: agentId ?? "meta", context } }),
  closeConfirm: () =>
    set((state) => ({ confirm: { ...state.confirm, open: false, requestId: "" } })),
  openSettings: (tab) =>
    set((state) => {
      const openToTab =
        tab !== undefined && isSettingsTab(tab) ? tab : undefined;
      return {
        settings: {
          ...state.settings,
          open: true,
          openToTab,
        },
      };
    }),
  closeSettings: () =>
    set((state) => ({
      settings: { ...state.settings, open: false, openToTab: undefined },
    })),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  openTokenDashboard: () =>
    set((state) => ({
      tokenDashboard: { ...state.tokenDashboard, open: true },
    })),
  closeTokenDashboard: () =>
    set((state) => ({
      tokenDashboard: { ...state.tokenDashboard, open: false },
    })),
  setTokenDashboardRange: (range) =>
    set((state) => ({
      tokenDashboard: { ...state.tokenDashboard, range },
    })),
  setTokenDashboardCustomRange: (customFrom, customTo) =>
    set((state) => ({
      tokenDashboard: { ...state.tokenDashboard, customFrom, customTo, range: "custom" },
    })),
}));
