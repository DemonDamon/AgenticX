import { describe, expect, it } from "vitest";
import {
  applyTurnIntentToggle,
  normalizeTurnIntent,
  resolveRequestTurnIntent,
  togglePlanIntent,
} from "./turn-intent";

describe("turn-intent", () => {
  it("normalizes unknown values to default", () => {
    expect(normalizeTurnIntent("plan")).toBe("plan");
    expect(normalizeTurnIntent("isolate")).toBe("isolate");
    expect(normalizeTurnIntent("multitask")).toBe("isolate");
    expect(normalizeTurnIntent("ASK")).toBe("default");
    expect(normalizeTurnIntent(undefined)).toBe("default");
  });

  it("turns plan and isolate on and off exclusively", () => {
    expect(applyTurnIntentToggle("default", "plan", true)).toBe("plan");
    expect(applyTurnIntentToggle("plan", "plan", false)).toBe("default");
    expect(applyTurnIntentToggle("default", "isolate", true)).toBe("isolate");
    expect(applyTurnIntentToggle("isolate", "isolate", false)).toBe("default");
    expect(applyTurnIntentToggle("plan", "isolate", true)).toBe("isolate");
    expect(applyTurnIntentToggle("isolate", "plan", true)).toBe("plan");
    expect(applyTurnIntentToggle("plan", "isolate", false)).toBe("plan");
  });

  it("toggles plan from the shortcut", () => {
    expect(togglePlanIntent("default")).toBe("plan");
    expect(togglePlanIntent("plan")).toBe("default");
    expect(togglePlanIntent("isolate")).toBe("plan");
  });

  it("keeps the pane preference unless a request explicitly overrides it", () => {
    expect(resolveRequestTurnIntent("plan")).toBe("plan");
    expect(resolveRequestTurnIntent("plan", "default")).toBe("default");
    expect(resolveRequestTurnIntent("isolate", "default")).toBe("default");
  });
});
