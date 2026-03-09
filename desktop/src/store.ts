import { create } from "zustand";

export type UiStatus = "idle" | "listening" | "processing";
export type MsgRole = "user" | "assistant" | "tool";
export type SubAgentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

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
  setApiBase: (base: string) => void;
  setApiToken: (token: string) => void;
  setSessionId: (id: string) => void;
  setStatus: (status: UiStatus) => void;
  setActiveModel: (provider: string, model: string) => void;
  addMessage: (role: MsgRole, content: string, agentId?: string, provider?: string, model?: string) => void;
  insertMessageAfter: (afterId: string, msg: Omit<Message, "id">) => string;
  addSubAgent: (item: Pick<SubAgent, "id" | "name" | "role" | "task">) => void;
  updateSubAgent: (id: string, patch: Partial<SubAgent>) => void;
  addSubAgentEvent: (id: string, event: Omit<SubAgentEvent, "id" | "ts">) => void;
  removeSubAgent: (id: string) => void;
  setSelectedSubAgent: (id: string | null) => void;
  setCodePreview: (code: string) => void;
  openConfirm: (requestId: string, question: string, diff?: string, agentId?: string) => void;
  closeConfirm: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Pick<SettingsState, "provider" | "model" | "apiKey" | "defaultProvider" | "providers">>) => void;
};

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useAppStore = create<AppState>((set) => ({
  apiBase: "",
  apiToken: "",
  sessionId: "",
  status: "idle",
  messages: [],
  activeProvider: "",
  activeModel: "",
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
  addMessage: (role, content, agentId, provider, model) =>
    set((state) => ({
      messages: [...state.messages, { id: uid(), role, content, agentId, provider, model }]
    })),
  insertMessageAfter: (afterId, msg) => {
    const newId = uid();
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === afterId);
      const insertAt = idx >= 0 ? idx + 1 : state.messages.length;
      const next = [...state.messages];
      next.splice(insertAt, 0, { ...msg, id: newId });
      return { messages: next };
    });
    return newId;
  },
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
  openConfirm: (requestId, question, diff, agentId) =>
    set({ confirm: { open: true, requestId, question, diff, agentId: agentId ?? "meta" } }),
  closeConfirm: () =>
    set((state) => ({ confirm: { ...state.confirm, open: false, requestId: "" } })),
  openSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: true } })),
  closeSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: false } })),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } }))
}));
