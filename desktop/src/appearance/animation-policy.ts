import type { MotionMode, WallpaperType } from "../../shared/chat-appearance";
export function mayAnimate(input: {
  motion: MotionMode; type: WallpaperType; focused: boolean; visible: boolean;
  reducedMotion: boolean; unavailable: boolean; preview: boolean; previewActive: boolean;
}): boolean {
  return input.motion !== "off" && (input.type === "gradient" || input.type === "shader") &&
    input.focused && input.visible && !input.reducedMotion && !input.unavailable &&
    (input.preview || !input.previewActive);
}
export function shouldSendPulse(input: {
  avatarId: string | null; sessionId: string; currentSessionId: string;
  continuation: boolean; suppressUserEcho: boolean; skipUserHistory: boolean; hasReader: boolean;
}): boolean {
  return !input.avatarId?.startsWith("automation:") && !!input.sessionId && input.sessionId === input.currentSessionId &&
    !input.continuation && !input.suppressUserEcho && !input.skipUserHistory && input.hasReader;
}
