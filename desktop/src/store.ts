import { create } from "zustand";

export type UiStatus = "idle" | "listening" | "processing";
export type MsgRole = "user" | "assistant" | "tool";

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
};

type ConfirmState = {
  open: boolean;
  requestId: string;
  question: string;
  diff?: string;
};

type SettingsState = {
  open: boolean;
  provider: string;
  model: string;
  apiKey: string;
};

type AppState = {
  apiBase: string;
  apiToken: string;
  sessionId: string;
  status: UiStatus;
  sidebarOpen: boolean;
  messages: Message[];
  codePreview: string;
  confirm: ConfirmState;
  settings: SettingsState;
  floatingPos: { x: number; y: number };
  setApiBase: (base: string) => void;
  setApiToken: (token: string) => void;
  setSessionId: (id: string) => void;
  setStatus: (status: UiStatus) => void;
  setSidebarOpen: (open: boolean) => void;
  addMessage: (role: MsgRole, content: string) => void;
  setCodePreview: (code: string) => void;
  openConfirm: (requestId: string, question: string, diff?: string) => void;
  closeConfirm: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Pick<SettingsState, "provider" | "model" | "apiKey">>) => void;
  setFloatingPos: (x: number, y: number) => void;
};

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useAppStore = create<AppState>((set) => ({
  apiBase: "",
  apiToken: "",
  sessionId: "",
  status: "idle",
  sidebarOpen: true,
  messages: [],
  codePreview: "",
  confirm: { open: false, requestId: "", question: "" },
  settings: { open: false, provider: "", model: "", apiKey: "" },
  floatingPos: { x: 24, y: 24 },
  setApiBase: (apiBase) => set({ apiBase }),
  setApiToken: (apiToken) => set({ apiToken }),
  setSessionId: (sessionId) => set({ sessionId }),
  setStatus: (status) => set({ status }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  addMessage: (role, content) =>
    set((state) => ({
      messages: [...state.messages, { id: uid(), role, content }]
    })),
  setCodePreview: (codePreview) => set({ codePreview }),
  openConfirm: (requestId, question, diff) =>
    set({ confirm: { open: true, requestId, question, diff } }),
  closeConfirm: () =>
    set((state) => ({ confirm: { ...state.confirm, open: false } })),
  openSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: true } })),
  closeSettings: () =>
    set((state) => ({ settings: { ...state.settings, open: false } })),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  setFloatingPos: (x, y) => set({ floatingPos: { x, y } })
}));
