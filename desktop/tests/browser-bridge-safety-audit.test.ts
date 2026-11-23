/**
 * SP4 · Safety-layer audit — extension-backend action log tests.
 *
 * Covers the SP4 additions to electron/browser-bridge.ts:
 *   - every extension-backend act appends one line to the EXISTING audit
 *     outbox (AGX_HOME/action_audit/outbox.jsonl) with source:"extension" and
 *     tab_url, in the v:1 shape the action-audit-uploader drains;
 *   - blocked / confirmed / declined / timeout outcomes are all recorded;
 *   - rows missing source/tab_url (older SW builds) are defaulted on the
 *     NM-forwarding settle path;
 *   - emitting is gated like the Python audit_enabled(): enterprise.enabled
 *     plus a non-empty token in AGX_HOME/config.yaml.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    ipcHandlers,
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) =>
        ipcHandlers.set(channel, fn),
      removeHandler: (channel: string) => ipcHandlers.delete(channel),
    },
    webContents: { fromId: () => null },
  };
});
vi.mock("electron", () => electronMock);

import { refreshAgxHomeCache } from "../electron/agx-home";
import {
  startNearBrowserBridge,
  stopNearBrowserBridge,
  type NmChannel,
} from "../electron/browser-bridge";

type AuditLine = {
  v: number;
  event_id: string;
  ts: string;
  kind: string;
  session_id: string;
  tool_name: string;
  outcome: string;
  decision_source: string;
  risk: string;
  args_digest: string;
  summary: string;
  source: string;
  tab_url: string;
};

function readAuditLines(home: string): AuditLine[] {
  const outbox = path.join(home, "action_audit", "outbox.jsonl");
  if (!fs.existsSync(outbox)) return [];
  return fs
    .readFileSync(outbox, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditLine);
}

/** enterprise enabled gate, same condition the Python audit_enabled() uses. */
function writeEnterpriseConfig(home: string, enabled = true, token = "audit-token"): void {
  const body = [
    "version: '1'",
    enabled ? "enterprise:" : "enterprise:",
    `  enabled: ${enabled ? "true" : "false"}`,
    enabled ? `  token: ${token}` : "",
    "  base_url: 'http://127.0.0.1:9'",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  fs.writeFileSync(path.join(home, "config.yaml"), `${body}\n`, "utf8");
}

type MockNm = {
  online: () => boolean;
  onSend?: (
    message: Record<string, unknown>,
    reply: (row: Record<string, unknown>) => void,
  ) => void;
};

function createMockNmChannel(options: MockNm) {
  let actResultHandler: ((row: Record<string, unknown>) => void) | null = null;
  const channel: NmChannel = {
    extensionOnline: () => options.online() ?? true,
    sendAct: (message) => {
      if (!channel.extensionOnline()) return false;
      options.onSend?.(message, (row) => {
        actResultHandler?.({ request_id: message.request_id, ...row });
      });
      return true;
    },
    onActResult: (handler) => {
      actResultHandler = handler;
    },
  };
  return channel;
}

async function waitForBridgeEndpoint(home: string): Promise<{ base: string; token: string }> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      const port = Number(fs.readFileSync(path.join(home, "browser_bridge.port"), "utf8").trim());
      const token = fs.readFileSync(path.join(home, "browser_bridge.token"), "utf8").trim();
      const base = `http://127.0.0.1:${port}`;
      const res = await fetch(`${base}/v1/browser/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return { base, token };
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("bridge HTTP server did not come up within 5s");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function postAct(
  endpoint: { base: string; token: string },
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint.base}/v1/browser/act`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("browser-bridge SP4 safety audit", () => {
  let tmpHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-bridge-sp4-test-"));
    savedEnv = {
      AGX_HOME: process.env.AGX_HOME,
      AGENTICX_HOME: process.env.AGENTICX_HOME,
      AGX_BROWSER_BACKEND: process.env.AGX_BROWSER_BACKEND,
    };
    process.env.AGX_HOME = tmpHome;
    delete process.env.AGENTICX_HOME;
    process.env.AGX_BROWSER_BACKEND = "extension";
    refreshAgxHomeCache();
  });

  afterEach(() => {
    stopNearBrowserBridge();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    refreshAgxHomeCache();
    electronMock.ipcHandlers.clear();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("appends a completed action line with source=extension and tab_url", async () => {
    writeEnterpriseConfig(tmpHome);
    const channel = createMockNmChannel({
      online: () => true,
      onSend: (_message, reply) => {
        reply({
          ok: true,
          action: "open",
          url: "https://example.com/page",
          backend: "extension",
        });
      },
    });
    startNearBrowserBridge(() => null, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint(tmpHome);

    const body = await postAct(endpoint, {
      session_id: "s-audit",
      action: "open",
      url: "https://example.com/page",
    });
    expect(body.ok).toBe(true);
    expect(body.source).toBe("extension"); // defaulted on the settle path

    const lines = readAuditLines(tmpHome);
    expect(lines).toHaveLength(1);
    const row = lines[0]!;
    expect(row.v).toBe(1);
    expect(row.source).toBe("extension");
    expect(row.tab_url).toBe("https://example.com/page");
    expect(row.kind).toBe("browser_action");
    expect(row.session_id).toBe("s-audit");
    expect(row.tool_name).toBe("near_browser_open");
    expect(row.outcome).toBe("completed");
    expect(row.decision_source).toBe("extension");
    expect(row.risk).toBe("low");
    expect(row.args_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(row.summary).toContain("near_browser_open");
  });

  it("records blocked and confirmed outcomes with high risk", async () => {
    writeEnterpriseConfig(tmpHome);
    let replyIndex = 0;
    const channel = createMockNmChannel({
      online: () => true,
      onSend: (_message, reply) => {
        replyIndex += 1;
        if (replyIndex === 1) {
          reply({
            ok: false,
            blocked: true,
            error: "blocked: sensitive domain",
            domain: "www.icbc.com.cn",
            tab_url: "https://www.icbc.com.cn/",
          });
        } else {
          reply({
            ok: true,
            confirmed: true,
            action: "click",
            url: "https://example.com/form",
          });
        }
      },
    });
    startNearBrowserBridge(() => null, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint(tmpHome);

    const blocked = await postAct(endpoint, {
      session_id: "s-b",
      action: "open",
      url: "https://www.icbc.com.cn/",
    });
    expect(blocked.error).toBe("blocked: sensitive domain");

    const confirmed = await postAct(endpoint, {
      session_id: "s-b",
      action: "click",
      index: 3,
    });
    expect(confirmed.confirmed).toBe(true);

    const lines = readAuditLines(tmpHome);
    expect(lines).toHaveLength(2);
    const blockedRow = lines.find((line) => line.outcome === "blocked");
    const confirmedRow = lines.find((line) => line.outcome === "confirmed");
    expect(blockedRow).toBeDefined();
    expect(blockedRow?.risk).toBe("high");
    expect(blockedRow?.tab_url).toBe("https://www.icbc.com.cn/");
    expect(blockedRow?.summary).toContain("www.icbc.com.cn");
    expect(confirmedRow).toBeDefined();
    expect(confirmedRow?.risk).toBe("high");
    expect(confirmedRow?.tool_name).toBe("near_browser_click");
  });

  it("records timeouts (and never writes when the enterprise gate is off)", async () => {
    writeEnterpriseConfig(tmpHome, false);
    const channel = createMockNmChannel({ online: () => true }); // swallows the act
    startNearBrowserBridge(() => null, { nmChannel: channel, timeoutMs: () => 60 });
    const endpoint = await waitForBridgeEndpoint(tmpHome);

    const body = await postAct(endpoint, { session_id: "s-t", action: "extract_text" });
    expect(body.error).toBe("timeout");
    expect(readAuditLines(tmpHome)).toHaveLength(0); // gate closed → no audit file content

    // Flip the gate on: the same timeout must now be audited.
    writeEnterpriseConfig(tmpHome);
    await postAct(endpoint, { session_id: "s-t", action: "extract_text" });
    const lines = readAuditLines(tmpHome);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.outcome).toBe("timeout");
    expect(lines[0]!.source).toBe("extension");
  });
});
