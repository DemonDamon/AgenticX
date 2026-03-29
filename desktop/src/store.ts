import { arrayMove } from "@dnd-kit/sortable";
import { create } from "zustand";

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
export type McpServer = {
  name: string;
  connected: boolean;
  command?: string;
};

export type Avatar = {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  pinned: boolean;
  createdBy: string;
  toolsEnabled?: Record<string, boolean>;
};

export type SessionItem = {
  sessionId: string;
  avatarId: string | null;
  sessionName: string | null;
  updatedAt: number;
  createdAt?: number;
  pinned?: boolean;
  archived?: boolean;
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
};

export type ChatPane = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
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
};

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
};

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

type ProviderEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
};

type SettingsState = {
  open: boolean;
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
  /** legacy compat */
  provider: string;
  model: string;
  apiKey: string;
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
  activeProvider: string;
  activeModel: string;
  userMode: "pro" | "lite";
  onboardingCompleted: boolean;
  commandPaletteOpen: boolean;
  keybindingsPanelOpen: boolean;
  planMode: boolean;
  theme: ThemeMode;
  chatStyle: ChatStyle;
  /** Shown on user bubbles and sent as group chat context label (empty → 「我」). */
  userDisplayName: string;
  confirmStrategy: ConfirmStrategy;
  mcpServers: McpServer[];
  avatars: Avatar[];
  activeAvatarId: string | null;
  avatarSessions: SessionItem[];
  groups: GroupChat[];
  panes: ChatPane[];
  activePaneId: string;
  /** After merge-forward, target pane runs one normal /api/chat with this text (cleared when consumed). */
  forwardAutoReply: { paneId: string; sessionId: string; text: string } | null;
  setForwardAutoReply: (job: { paneId: string; sessionId: string; text: string } | null) => void;
  setApiBase: (base: string) => void;
  setApiToken: (token: string) => void;
  setSessionId: (id: string) => void;
  setStatus: (status: UiStatus) => void;
  setActiveModel: (provider: string, model: string) => void;
  setUserMode: (mode: "pro" | "lite") => void;
  setOnboardingCompleted: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setKeybindingsPanelOpen: (v: boolean) => void;
  setPlanMode: (v: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setChatStyle: (style: ChatStyle) => void;
  setUserDisplayName: (name: string) => void;
  setConfirmStrategy: (v: ConfirmStrategy) => void;
  setMcpServers: (servers: McpServer[]) => void;
  setAvatars: (avatars: Avatar[]) => void;
  setActiveAvatarId: (id: string | null) => void;
  setAvatarSessions: (sessions: SessionItem[]) => void;
  setGroups: (groups: GroupChat[]) => void;
  setActivePaneId: (id: string) => void;
  addPane: (avatarId: string | null, avatarName: string, sessionId: string) => string;
  removePane: (paneId: string) => void;
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
    >
  ) => void;
  updateLastPaneMessage: (paneId: string, content: string) => void;
  clearPaneMessages: (paneId: string) => void;
  setPaneSessionId: (paneId: string, sessionId: string) => void;
  setPaneMessages: (paneId: string, messages: Message[]) => void;
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
  addPaneTerminalTab: (paneId: string, cwd: string, labelHint?: string) => void;
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
    >
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
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Pick<SettingsState, "provider" | "model" | "apiKey" | "defaultProvider" | "providers">>) => void;
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
  };
}

const CHAT_STYLE_STORAGE_KEY = "agx-chat-style";
const USER_DISPLAY_NAME_KEY = "agx-user-display-name";

function loadChatStyle(): ChatStyle {
  try {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") return saved;
  } catch {
    // ignore storage errors
  }
  return "im";
}

function loadUserDisplayName(): string {
  try {
    const saved = window.localStorage.getItem(USER_DISPLAY_NAME_KEY);
    if (typeof saved === "string") return saved.slice(0, 48);
  } catch {
    // ignore storage errors
  }
  return "";
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
  onboardingCompleted: false,
  commandPaletteOpen: false,
  keybindingsPanelOpen: false,
  planMode: false,
  theme: "dark",
  chatStyle: loadChatStyle(),
  userDisplayName: loadUserDisplayName(),
  confirmStrategy: "semi-auto",
  mcpServers: [],
  avatars: [],
  activeAvatarId: null,
  avatarSessions: [],
  groups: [],
  panes: [makeDefaultPane()],
  activePaneId: "pane-meta",
  forwardAutoReply: null,
  subAgents: [],
  selectedSubAgent: null,
  codePreview: "",
  confirm: { open: false, requestId: "", question: "", agentId: "meta" },
  settings: { open: false, provider: "", model: "", apiKey: "", defaultProvider: "", providers: {} },
  setApiBase: (apiBase) => set({ apiBase }),
  setApiToken: (apiToken) => set({ apiToken }),
  setSessionId: (sessionId) => set({ sessionId }),
  setStatus: (status) => set({ status }),
  setActiveModel: (activeProvider, activeModel) => set({ activeProvider, activeModel }),
  setUserMode: (userMode) => set({ userMode }),
  setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setKeybindingsPanelOpen: (keybindingsPanelOpen) => set({ keybindingsPanelOpen }),
  setPlanMode: (planMode) => set({ planMode }),
  setTheme: (theme) => set({ theme }),
  setChatStyle: (chatStyle) =>
    set(() => {
      try {
        window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, chatStyle);
      } catch {
        // ignore storage errors
      }
      return { chatStyle };
    }),
  setUserDisplayName: (userDisplayName) =>
    set(() => {
      const next = String(userDisplayName ?? "").slice(0, 48);
      try {
        if (next.trim()) window.localStorage.setItem(USER_DISPLAY_NAME_KEY, next);
        else window.localStorage.removeItem(USER_DISPLAY_NAME_KEY);
      } catch {
        // ignore storage errors
      }
      return { userDisplayName: next };
    }),
  setConfirmStrategy: (confirmStrategy) => set({ confirmStrategy }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setAvatars: (avatars) => set({ avatars }),
  setActiveAvatarId: (activeAvatarId) => set({ activeAvatarId }),
  setAvatarSessions: (avatarSessions) => set({ avatarSessions }),
  setGroups: (groups) => set({ groups }),
  setActivePaneId: (activePaneId) => set({ activePaneId }),
  setForwardAutoReply: (forwardAutoReply) => set({ forwardAutoReply }),
  addPane: (avatarId, avatarName, sessionId) => {
    const paneId = uid();
    set((state) => ({
      panes: [
        ...state.panes,
        {
          id: paneId,
          avatarId,
          avatarName,
          sessionId,
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
      return { panes: nextPanes, activePaneId: nextActive };
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
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              sessionTokens: {
                input: (pane.sessionTokens?.input ?? 0) + input,
                output: (pane.sessionTokens?.output ?? 0) + output,
              },
            }
          : pane
      ),
    })),
  setPaneSessionId: (paneId, sessionId) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, sessionId } : pane)),
    })),
  setPaneMessages: (paneId, messages) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, messages } : pane)),
    })),
  togglePaneHistory: (paneId) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, historyOpen: !pane.historyOpen } : pane
      ),
    })),
  cycleSidePanel: (paneId, tab) =>
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        if (tab === "workspace") {
          return { ...pane, taskspacePanelOpen: !pane.taskspacePanelOpen, sidePanelTab: "workspace" };
        }
        return { ...pane, membersPanelOpen: !pane.membersPanelOpen, sidePanelTab: "members" };
      }),
    })),
  openSidePanel: (paneId, tab) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? tab === "workspace"
            ? { ...pane, taskspacePanelOpen: true, sidePanelTab: "workspace" }
            : { ...pane, membersPanelOpen: true, sidePanelTab: "members" }
          : pane
      ),
    })),
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
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              spawnsColumnOpen: open,
              ...(open ? { spawnsColumnSuppressAuto: false, spawnsColumnBaselineIds: [] } : {}),
            }
          : pane
      ),
    })),
  dismissSpawnsColumn: (paneId, baselineSubAgentIds) =>
    set((state) => ({
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
    })),
  clearSpawnsColumnSuppress: (paneId) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, spawnsColumnSuppressAuto: false, spawnsColumnBaselineIds: [] }
          : pane
      ),
    })),
  addPaneTerminalTab: (paneId, cwd, labelHint) =>
    set((state) => {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return state;
      const trimmed = (cwd || "").trim();
      if (!trimmed) return state;
      const baseRaw = (labelHint ?? "").trim() || trimmed.split(/[/\\]/).filter(Boolean).pop() || "terminal";
      const sameCwd = pane.terminalTabs.filter((t) => t.cwd === trimmed).length;
      const label = sameCwd === 0 ? baseRaw : `${baseRaw} (#${sameCwd + 1})`;
      const id = uid();
      return {
        panes: state.panes.map((p) =>
          p.id === paneId
            ? {
                ...p,
                terminalTabs: [...p.terminalTabs, { id, cwd: trimmed, label }],
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
  openSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: true } })),
  closeSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: false } })),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } }))
}));
