import { describe, expect, it } from "vitest";
import {
  MA_LAST_SESSION_KEY,
  forgetManagedSession,
  getLastManagedSession,
  isManagedPaneAvatarId,
  managedAgentIdOf,
  managedPaneAvatarId,
  parseEnterpriseAgents,
  rememberManagedSession,
} from "./ma-pane";

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("managed pane ids", () => {
  it("isManagedPaneAvatarId accepts only ma:<ULID>", () => {
    expect(isManagedPaneAvatarId(`ma:${AGENT}`)).toBe(true);
    expect(isManagedPaneAvatarId("ma:bad")).toBe(false);
    expect(isManagedPaneAvatarId(`group:${AGENT}`)).toBe(false);
    expect(isManagedPaneAvatarId(null)).toBe(false);
    expect(isManagedPaneAvatarId(undefined)).toBe(false);
    expect(managedPaneAvatarId(AGENT)).toBe(`ma:${AGENT}`);
    expect(managedAgentIdOf(`ma:${AGENT}`)).toBe(AGENT);
    expect(managedAgentIdOf("ma:bad")).toBeNull();
  });
});

describe("managed last session", () => {
  it("remember/get/forget round-trips and ignores corrupt storage", () => {
    const storage = memoryStorage();
    expect(getLastManagedSession(AGENT, storage)).toBeNull();
    storage.setItem(MA_LAST_SESSION_KEY, "{");
    expect(getLastManagedSession(AGENT, storage)).toBeNull();
    rememberManagedSession(AGENT, "01HMASESSION0000000000000A", storage, () => 20);
    expect(getLastManagedSession(AGENT, storage)).toBe("01HMASESSION0000000000000A");
    forgetManagedSession(AGENT, storage);
    expect(getLastManagedSession(AGENT, storage)).toBeNull();
  });

  it("evicts oldest beyond 100", () => {
    const storage = memoryStorage();
    let clock = 0;
    for (let index = 0; index < 101; index += 1) {
      clock = index + 1;
      rememberManagedSession(`agent-${index}`, `session-${index}`, storage, () => clock);
    }
    const raw = JSON.parse(storage.getItem(MA_LAST_SESSION_KEY) || "{}") as Record<string, unknown>;
    expect(Object.keys(raw)).toHaveLength(100);
    expect(getLastManagedSession("agent-0", storage)).toBeNull();
    expect(getLastManagedSession("agent-1", storage)).toBe("session-1");
    expect(getLastManagedSession("agent-100", storage)).toBe("session-100");
  });
});

describe("parseEnterpriseAgents", () => {
  it("falls back for legacy payload", () => {
    const cards = parseEnterpriseAgents({
      agents: [
        {
          id: AGENT,
          slug: "report-bot",
          displayName: "报告助手",
          description: null,
          runtime: "desktop_worker",
          model: "openai/gpt-4o",
          origin: "enterprise",
          systemPrompt: "你是报告助手",
        },
        { displayName: "缺 id" },
        { id: "only-id" },
        null,
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.effectiveVersion).toBe(1);
    expect(cards[0]?.latestVersion).toBe(1);
    expect(cards[0]?.executionTarget).toBe("desktop_worker");
    expect(cards[0]?.defaultEnvironment).toBeNull();
    expect(cards[0]?.routingMode).toBe("follow_latest");
    expect(cards[0]?.ownedByMe).toBe(false);
  });
});
