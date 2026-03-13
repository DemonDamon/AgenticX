import { create } from "zustand";

export type UiStatus = "idle" | "listening" | "processing";
export type MsgRole = "user" | "assistant" | "tool";
export type SubAgentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type ConfirmStrategy = "manual" | "semi-auto" | "auto";
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
};

export type SessionItem = {
  sessionId: string;
  avatarId: string | null;
  sessionName: string | null;
  updatedAt: number;
};

export type GroupChat = {
  id: string;
  name: string;
  avatarIds: string[];
  routing: string;
};

export type ChatPane = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  messages: Message[];
  historyOpen: boolean;
  contextInherited: boolean;
};

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
  agentId?: string;
  provider?: string;
  model?: string;
};

export type SubAgentEvent = {
  id: string;
  type: string;
  content: string;
  ts: number;
};

export type SubAgent = {
  id: string;
  name: string;
  role: string;
  status: SubAgentStatus;
  task: string;
  progress?: number;
  currentAction?: string;
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
  confirmStrategy: ConfirmStrategy;
  mcpServers: McpServer[];
  avatars: Avatar[];
  activeAvatarId: string | null;
  avatarSessions: SessionItem[];
  groups: GroupChat[];
  panes: ChatPane[];
  activePaneId: string;
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
  setConfirmStrategy: (v: ConfirmStrategy) => void;
  setMcpServers: (servers: McpServer[]) => void;
  setAvatars: (avatars: Avatar[]) => void;
  setActiveAvatarId: (id: string | null) => void;
  setAvatarSessions: (sessions: SessionItem[]) => void;
  setGroups: (groups: GroupChat[]) => void;
  setActivePaneId: (id: string) => void;
  addPane: (avatarId: string | null, avatarName: string, sessionId: string) => string;
  removePane: (paneId: string) => void;
  addPaneMessage: (paneId: string, role: MsgRole, content: string, agentId?: string, provider?: string, model?: string) => void;
  clearPaneMessages: (paneId: string) => void;
  setPaneSessionId: (paneId: string, sessionId: string) => void;
  setPaneMessages: (paneId: string, messages: Message[]) => void;
  togglePaneHistory: (paneId: string) => void;
  setPaneContextInherited: (paneId: string, inherited: boolean) => void;
  addMessage: (role: MsgRole, content: string, agentId?: string, provider?: string, model?: string) => void;
  insertMessageAfter: (afterId: string, msg: Omit<Message, "id">) => string;
  clearMessages: () => void;
  addSubAgent: (item: Pick<SubAgent, "id" | "name" | "role" | "task">) => void;
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
    avatarName: "Meta-Agent",
    sessionId: "",
    messages: [],
    historyOpen: false,
    contextInherited: false,
  };
}

export const useAppStore = create<AppState>((set) => ({
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
  confirmStrategy: "semi-auto",
  mcpServers: [],
  avatars: [],
  activeAvatarId: null,
  avatarSessions: [],
  groups: [],
  panes: [makeDefaultPane()],
  activePaneId: "pane-meta",
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
  setConfirmStrategy: (confirmStrategy) => set({ confirmStrategy }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setAvatars: (avatars) => set({ avatars }),
  setActiveAvatarId: (activeAvatarId) => set({ activeAvatarId }),
  setAvatarSessions: (avatarSessions) => set({ avatarSessions }),
  setGroups: (groups) => set({ groups }),
  setActivePaneId: (activePaneId) => set({ activePaneId }),
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
  addPaneMessage: (paneId, role, content, agentId, provider, model) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              messages: [...pane.messages, { id: uid(), role, content, agentId, provider, model }],
            }
          : pane
      ),
    })),
  clearPaneMessages: (paneId) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, messages: [] } : pane)),
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
  setPaneContextInherited: (paneId, inherited) =>
    set((state) => ({
      panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, contextInherited: inherited } : pane)),
    })),
  addMessage: (role, content, agentId, provider, model) =>
    set((state) => {
      const nextMessage: Message = { id: uid(), role, content, agentId, provider, model };
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
        return state;
      }
      const next: SubAgent = {
        ...item,
        status: "running",
        events: []
      };
      return { subAgents: [...state.subAgents, next] };
    }),
  updateSubAgent: (id, patch) =>
    set((state) => ({
      subAgents: state.subAgents.map((item) => (item.id === id ? { ...item, ...patch } : item))
    })),
  addSubAgentEvent: (id, event) =>
    set((state) => ({
      subAgents: state.subAgents.map((item) =>
        item.id === id
          ? {
              ...item,
              events: [
                ...item.events,
                { id: uid(), ts: Date.now(), type: event.type, content: event.content }
              ].slice(-100)
            }
          : item
      )
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
