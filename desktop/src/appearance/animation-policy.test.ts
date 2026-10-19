import { describe, expect, it } from "vitest";
import { mayAnimate, shouldSendPulse } from "./animation-policy";
const active = { motion: "continuous" as const, type: "gradient" as const, focused: true, visible: true, reducedMotion: false, unavailable: false, preview: false, previewActive: false };
describe("animation ownership", () => {
  it("allows only the focused visible pane, and yields to settings preview", () => {
    expect(mayAnimate(active)).toBe(true);
    for (const patch of [{ focused: false }, { visible: false }, { reducedMotion: true }, { unavailable: true }, { previewActive: true }, { motion: "off" as const }, { type: "image" as const }]) expect(mayAnimate({ ...active, ...patch })).toBe(false);
    expect(mayAnimate({ ...active, preview: true, previewActive: true })).toBe(true);
  });
  it("accepts only a current-session user send", () => {
    const accepted = { avatarId: null, sessionId: "s1", currentSessionId: "s1", continuation: false, suppressUserEcho: false, skipUserHistory: false, hasReader: true };
    expect(shouldSendPulse(accepted)).toBe(true);
    for (const patch of [{ currentSessionId: "s2" }, { continuation: true }, { suppressUserEcho: true }, { skipUserHistory: true }, { hasReader: false }, { avatarId: "automation:task" }]) expect(shouldSendPulse({ ...accepted, ...patch })).toBe(false);
  });
});
