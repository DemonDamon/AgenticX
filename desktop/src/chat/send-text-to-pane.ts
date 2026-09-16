export type PaneTextSender = (text: string) => Promise<void>;

type PendingSend = {
  text: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const senders = new Map<string, PaneTextSender>();
const pending = new Map<string, PendingSend>();

export function createPaneTextSender(
  sendThroughExistingPipeline: PaneTextSender,
  restoreComposerText: (text: string) => void,
): PaneTextSender {
  return async (text) => {
    try {
      await sendThroughExistingPipeline(text);
    } catch (error) {
      restoreComposerText(text);
      throw error;
    }
  };
}

export function registerPaneTextSender(
  paneId: string,
  sender: PaneTextSender,
): () => void {
  senders.set(paneId, sender);
  const queued = pending.get(paneId);
  if (queued) {
    pending.delete(paneId);
    void sender(queued.text).then(queued.resolve, queued.reject);
  }
  return () => {
    if (senders.get(paneId) === sender) senders.delete(paneId);
  };
}

export function sendTextToPane(paneId: string, text: string): Promise<void> {
  const normalized = text.trim();
  if (!normalized) return Promise.reject(new Error("instruction_required"));
  const sender = senders.get(paneId);
  if (sender) return sender(normalized);
  const previous = pending.get(paneId);
  if (previous) {
    return Promise.reject(new Error("pane_send_already_queued"));
  }
  return new Promise<void>((resolve, reject) => {
    pending.set(paneId, { text: normalized, resolve, reject });
  });
}
