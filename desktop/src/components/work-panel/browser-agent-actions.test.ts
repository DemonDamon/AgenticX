import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_AGENT_EXTRACT_JS,
  browserAgentExtractJs,
  browserAgentTypeJs,
  filterExtractedText,
  parseBrowserAgentResult,
} from "./browser-agent-actions";
import {
  _resetBrowserAgentRegistryForTests,
  ensureBrowserAgentIpc,
  isBrowserHumanTakeover,
  registerBrowserAgentController,
  setBrowserHumanTakeover,
} from "./browser-agent-registry";

describe("parseBrowserAgentResult", () => {
  it("returns ok:false for empty or malformed payloads without throwing", () => {
    expect(parseBrowserAgentResult("")).toEqual({ ok: false, error: "empty_result" });
    expect(parseBrowserAgentResult("not-json")).toEqual({ ok: false, error: "invalid_json" });
    expect(parseBrowserAgentResult(null).ok).toBe(false);
    expect(parseBrowserAgentResult([]).ok).toBe(false);
  });

  it("parses a snapshot payload", () => {
    const parsed = parseBrowserAgentResult({
      ok: true,
      url: "https://example.com/",
      title: "Example",
      elements: [{ index: 0, tag: "input", type: "password", is_password: true, text: "" }],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.elements?.[0]?.is_password).toBe(true);
  });
});

describe("browserAgentExtractJs", () => {
  it("walks shadow roots and same-origin iframes", () => {
    expect(BROWSER_AGENT_EXTRACT_JS).toContain("shadowRoot");
    expect(BROWSER_AGENT_EXTRACT_JS).toContain("contentDocument");
    expect(BROWSER_AGENT_EXTRACT_JS).toContain("nearCollectVisibleText");
    const queried = browserAgentExtractJs("源码");
    expect(queried).toContain("shadowRoot");
    expect(queried).toContain("contentDocument");
    expect(queried).toContain("源码");
  });

  it("filters extracted lines by query", () => {
    const raw = "标题行\n源码同步基线\n登录/注册";
    expect(filterExtractedText(raw, "源码")).toBe("源码同步基线");
    expect(filterExtractedText(raw)).toContain("源码同步基线");
  });
});

describe("browserAgentTypeJs", () => {
  it("uses the native value setter and dispatches input+change", () => {
    const script = browserAgentTypeJs(2, "secret", true);
    expect(script).toContain("getOwnPropertyDescriptor");
    expect(script).toContain('new Event("input", { bubbles: true })');
    expect(script).toContain('new Event("change", { bubbles: true })');
    expect(script).toContain("requestSubmit");
    expect(script).toContain('"secret"');
  });
});

describe("browser-agent-registry", () => {
  const replies: Array<Record<string, unknown>> = [];
  let actHandler: ((payload: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    replies.length = 0;
    actHandler = null;
    _resetBrowserAgentRegistryForTests();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agenticxDesktop: {
          onNearBrowserAct: (cb: (payload: Record<string, unknown>) => void) => {
            actHandler = cb;
            return () => {
              actHandler = null;
            };
          },
          replyNearBrowserAct: async (payload: Record<string, unknown>) => {
            replies.push(payload);
          },
        },
      },
    });
    ensureBrowserAgentIpc();
  });

  it("rejects actions after human takeover", async () => {
    registerBrowserAgentController("s1", {
      open: async () => ({ ok: true }),
      snapshot: async () => ({ ok: true, elements: [] }),
      click: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      extractText: async () => ({ ok: true, text: "" }),
      screenshot: async () => ({ ok: true, path: "/tmp/x.png" }),
    });
    setBrowserHumanTakeover("s1", true);
    expect(isBrowserHumanTakeover("s1")).toBe(true);
    actHandler?.({ request_id: "r1", session_id: "s1", action: "click", index: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replies[0]?.error).toBe("human_takeover");
  });

  it("returns no_browser_pane after unregister", async () => {
    const unregister = registerBrowserAgentController("s1", {
      open: async () => ({ ok: true }),
      snapshot: async () => ({ ok: true, elements: [] }),
      click: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      extractText: async () => ({ ok: true, text: "" }),
      screenshot: async () => ({ ok: true, path: "/tmp/x.png" }),
    });
    unregister();
    actHandler?.({ request_id: "r2", session_id: "s1", action: "snapshot" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replies[0]?.error).toBe("no_browser_pane");
  });

  it("walks open → snapshot → type → extract against a mock controller", async () => {
    const calls: string[] = [];
    registerBrowserAgentController("s1", {
      open: async (url) => {
        calls.push(`open:${url}`);
        return { ok: true, url };
      },
      snapshot: async () => {
        calls.push("snapshot");
        return {
          ok: true,
          url: "https://example.test/gate",
          elements: [
            { index: 0, tag: "input", type: "password", text: "", placeholder: "", href: "", value_len: 0, is_password: true },
            { index: 1, tag: "button", type: "", text: "Confirm", placeholder: "", href: "", value_len: 0, is_password: false },
          ],
        };
      },
      click: async (index) => {
        calls.push(`click:${index}`);
        return { ok: true };
      },
      type: async (index, text, submit) => {
        calls.push(`type:${index}:${text}:${submit ? "1" : "0"}`);
        return { ok: true };
      },
      pressKey: async () => ({ ok: true }),
      extractText: async () => {
        calls.push("extract");
        return { ok: true, text: "unlocked body" };
      },
      screenshot: async () => ({ ok: true, path: "/tmp/x.png" }),
    });
    actHandler?.({ request_id: "1", session_id: "s1", action: "open", url: "https://example.test/gate" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    actHandler?.({ request_id: "2", session_id: "s1", action: "snapshot" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    actHandler?.({ request_id: "3", session_id: "s1", action: "type", index: 0, text: "pw", submit: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    actHandler?.({ request_id: "4", session_id: "s1", action: "extract_text" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([
      "open:https://example.test/gate",
      "snapshot",
      "type:0:pw:1",
      "extract",
    ]);
    expect(replies.at(-1)?.text).toBe("unlocked body");
  });
});
