import { create } from "zustand";
import { emptyAppearanceDocument, type AppearanceDocument, type ChatAppearance } from "../../shared/chat-appearance";

type State = {
  document: AppearanceDocument; loaded: boolean; warning: string; error: string;
  previewActive: boolean; gpuUnavailable: boolean;
  pulse: { paneId: string; sessionId: string; turnId: string; seq: number } | null;
  load: () => Promise<void>;
  save: (scope: string, appearance: ChatAppearance | null, revision: number) => Promise<void>;
  setPreviewActive: (active: boolean) => void;
  markGpuUnavailable: () => void;
  sendPulse: (paneId: string, sessionId: string, turnId: string) => void;
};
let pendingLoad: Promise<void> | null = null;
export const useAppearanceStore = create<State>((set, get) => ({
  document: emptyAppearanceDocument(), loaded: false, warning: "", error: "",
  previewActive: false, gpuUnavailable: false, pulse: null,
  load: () => {
    if (pendingLoad) return pendingLoad;
    pendingLoad = Promise.resolve().then(async () => {
      try {
        const bridge = window.agenticxDesktop;
        if (!bridge?.loadChatAppearance) { set({ loaded: true }); return; }
        const result = await bridge.loadChatAppearance();
        if (!result.ok) throw new Error(result.error);
        set({ document: result.value, warning: result.warning ?? "", error: "", loaded: true });
      } catch (error) { set({ error: String(error), loaded: true }); }
    }).finally(() => { pendingLoad = null; });
    return pendingLoad;
  },
  save: async (scope, appearance, expectedRevision) => {
    const result = await window.agenticxDesktop.saveChatAppearance({ scope, appearance, expectedRevision });
    if (!result.ok) { await get().load(); throw new Error(result.error); }
    set({ document: result.value, warning: "", error: "" });
  },
  setPreviewActive: previewActive => set({ previewActive }),
  markGpuUnavailable: () => set({ gpuUnavailable: true }),
  sendPulse: (paneId, sessionId, turnId) => {
    const last = get().pulse;
    if (last?.turnId === turnId) return;
    set({ pulse: { paneId, sessionId, turnId, seq: (last?.seq ?? 0) + 1 } });
  },
}));
