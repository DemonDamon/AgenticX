export type KbDocumentOpenOverlayState = {
  visible: boolean;
  title: string;
  percent: number;
  status: "loading" | "done" | "error";
  error?: string;
};

let overlayState: KbDocumentOpenOverlayState | null = null;
const listeners = new Set<(state: KbDocumentOpenOverlayState | null) => void>();

function emit(state: KbDocumentOpenOverlayState | null) {
  overlayState = state;
  for (const listener of listeners) listener(state);
}

export function getKbDocumentOpenOverlaySnapshot(): KbDocumentOpenOverlayState | null {
  return overlayState;
}

export function subscribeKbDocumentOpenOverlay(
  listener: (state: KbDocumentOpenOverlayState | null) => void,
): () => void {
  listeners.add(listener);
  listener(overlayState);
  return () => listeners.delete(listener);
}

export function showKbDocumentOpenOverlay(title: string, percent = 0) {
  emit({
    visible: true,
    title,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    status: "loading",
  });
}

export function updateKbDocumentOpenOverlay(percent: number, title?: string) {
  if (!overlayState?.visible) return;
  emit({
    ...overlayState,
    title: title ?? overlayState.title,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    status: "loading",
  });
}

export function finishKbDocumentOpenOverlay() {
  if (!overlayState?.visible) return;
  emit({ ...overlayState, percent: 100, status: "done" });
  window.setTimeout(() => emit(null), 280);
}

export function failKbDocumentOpenOverlay(message: string) {
  emit({
    visible: true,
    title: overlayState?.title ?? "知识库文档",
    percent: overlayState?.percent ?? 0,
    status: "error",
    error: message,
  });
  window.setTimeout(() => emit(null), 2200);
}
