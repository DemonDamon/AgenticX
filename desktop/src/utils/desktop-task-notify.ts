import { isThinkingPlaceholderText } from "./stream-overlay-policy";

export const TASK_NOTIFY_TEXT_LIMIT = 80;

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?redacted_thinking>/gi, "")
    .replace(/<\/?think>/gi, "");
}

export function visibleNotifyText(text: string): string {
  const stripped = stripThinkBlocks(text).replace(/\s+/g, " ").trim();
  if (!stripped || isThinkingPlaceholderText(stripped)) return "";
  return stripped;
}

export function shouldAnnounceTaskComplete(input: {
  aborted: boolean;
  hasQueuedFollowup: boolean;
  isGroupPane: boolean;
  receivedFinalEvent: boolean;
  receivedGroupDone: boolean;
  text: string;
}): boolean {
  if (input.aborted || input.hasQueuedFollowup) return false;
  if (!visibleNotifyText(input.text)) return false;
  return input.isGroupPane ? input.receivedGroupDone : input.receivedFinalEvent;
}

export function decideNotifyPresentation(input: {
  desktopNotify: boolean;
  desktopSound: boolean;
  windowFocusedAndVisible: boolean;
}): { showBanner: boolean; playSound: boolean } {
  const playSound = input.desktopSound;
  const showBanner = input.desktopNotify && !input.windowFocusedAndVisible;
  return { showBanner, playSound };
}

export function clipNotifyText(text: string, limit = TASK_NOTIFY_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function formatTaskNotifyTitle(kind: "success" | "error", label: string, locale: "zh" | "en"): string {
  const prefix = kind === "error"
    ? (locale === "en" ? "Task failed" : "任务失败")
    : (locale === "en" ? "Task complete" : "任务完成");
  const name = (label || "Near").trim() || "Near";
  return clipNotifyText(`${prefix} · ${name}`);
}

export function formatTaskNotifyBody(text: string): string {
  return clipNotifyText(visibleNotifyText(text));
}

export function isDesktopWindowFocusedAndVisible(): boolean {
  return typeof document !== "undefined"
    && document.visibilityState === "visible"
    && document.hasFocus();
}

export async function announceDesktopTaskComplete(input: {
  kind: "success" | "error";
  label: string;
  text: string;
  paneId?: string;
  sessionId?: string;
  windowFocusedAndVisible: boolean;
  locale: "zh" | "en";
}): Promise<void> {
  const desktop = window.agenticxDesktop;
  if (!desktop?.notifyTaskComplete) return;
  let desktopNotify = true;
  let desktopSound = true;
  try {
    const loaded = await desktop.loadAutomationConfig?.();
    if (loaded?.ok && loaded.config) {
      desktopNotify = loaded.config.desktop_notify !== false;
      desktopSound = loaded.config.desktop_sound !== false;
    }
  } catch {
    // defaults stay on
  }
  const presentation = decideNotifyPresentation({
    desktopNotify,
    desktopSound,
    windowFocusedAndVisible: input.windowFocusedAndVisible,
  });
  if (!presentation.showBanner && !presentation.playSound) return;
  await desktop.notifyTaskComplete({
    title: formatTaskNotifyTitle(input.kind, input.label, input.locale),
    body: formatTaskNotifyBody(input.text),
    paneId: input.paneId,
    sessionId: input.sessionId,
    showBanner: presentation.showBanner,
    playSound: presentation.playSound,
  });
}
