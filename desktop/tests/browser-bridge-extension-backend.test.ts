/**
 * SP2 · ExtensionBackend bridge — dual-backend routing tests.
 *
 * Covers the SP2 additions to electron/browser-bridge.ts:
 *   - explicit extension backend: the act is forwarded over the (mocked or
 *     real) NM channel and settled by the extension's act_result row;
 *   - auto mode: picks the extension while the heartbeat is alive, and falls
 *     back to the embedded IPC path the moment it is not;
 *   - extension timeouts return the existing {ok:false, error:"timeout"} shape;
 *   - GET /v1/browser/status reports backend mode + heartbeat liveness.
 *
 * electron is mocked (vitest runs under plain node): ipcMain handlers are
 * captured so tests can play the WorkPanel renderer answering
 * "near-browser-act-result".
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";

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
import { startNmSocketServer } from "../electron/nm-socket-server";

describe("browser-bridge extension backend routing", () => {
  let tmpHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-bridge-sp2-test-"));
    savedEnv = {
      AGX_HOME: process.env.AGX_HOME,
      AGENTICX_HOME: process.env.AGENTICX_HOME,
      AGX_BROWSER_BACKEND: process.env.AGX_BROWSER_BACKEND,
    };
    // Bridge secrets land in the isolated AGX_HOME, never the real ~/.agenticx.
    process.env.AGX_HOME = tmpHome;
    delete process.env.AGENTICX_HOME;
    delete process.env.AGX_BROWSER_BACKEND;
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

  it("extension backend forwards the act over the NM channel and settles the stub reply", async () => {
    process.env.AGX_BROWSER_BACKEND = "extension";
    const { channel, sent } = createMockNmChannel({
      online: () => true,
      onSend: (message, reply) => {
        reply({
          ok: true,
          action: message.action,
          url: "about:blank",
          text: "[stub]",
          backend: "extension",
        });
      },
    });
    startNearBrowserBridge(() => null, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint();

    const body = await postAct(endpoint, {
      session_id: "s-ext",
      action: "open",
      url: "https://example.com/",
    });

    expect(body.ok).toBe(true);
    expect(body.backend).toBe("extension");
    expect(body.text).toBe("[stub]");
    expect(body.url).toBe("about:blank");
    expect(typeof body.request_id).toBe("string");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("act");
    expect(sent[0]?.session_id).toBe("s-ext");
    expect(sent[0]?.action).toBe("open");
    expect(sent[0]?.url).toBe("https://example.com/");
    expect(sent[0]?.request_id).toBe(body.request_id);
  });

  it("auto mode falls back to the embedded IPC path when the extension is offline", async () => {
    const { channel, sent } = createMockNmChannel({ online: () => false });
    const host = createMockHost();
    startNearBrowserBridge(() => host.webContents, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint();

    const pendingResponse = postAct(endpoint, { session_id: "s-embed", action: "snapshot" });
    // The request must land on the WorkPanel renderer IPC leg, not the NM channel.
    await vi.waitFor(() => expect(host.messages).toHaveLength(1));
    expect(sent).toHaveLength(0);
    const forwarded = host.messages[0]!;
    expect(forwarded.channel).toBe("near-browser-act");
    expect(forwarded.message.type).toBeUndefined(); // embedded wire format unchanged
    expect(forwarded.message.session_id).toBe("s-embed");
    expect(forwarded.message.action).toBe("snapshot");

    await replyOverIpc(forwarded.message.request_id, { ok: true, text: "embedded result" });

    const body = await pendingResponse;
    expect(body.ok).toBe(true);
    expect(body.text).toBe("embedded result");
    expect(body.backend).toBeUndefined();
  });

  it("auto mode picks the extension while the heartbeat says it is online", async () => {
    const { channel } = createMockNmChannel({
      online: () => true,
      onSend: (_message, reply) => {
        reply({ ok: true, url: "about:blank", text: "[stub]", backend: "extension" });
      },
    });
    const host = createMockHost();
    startNearBrowserBridge(() => host.webContents, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint();

    const body = await postAct(endpoint, { session_id: "s-auto", action: "click", index: 0 });

    expect(body.ok).toBe(true);
    expect(body.backend).toBe("extension");
    expect(host.messages).toHaveLength(0);
  });

  it("extension backend times out with the existing error shape when the extension never replies", async () => {
    process.env.AGX_BROWSER_BACKEND = "extension";
    const { channel, sent } = createMockNmChannel({ online: () => true }); // swallows the act
    startNearBrowserBridge(() => null, { nmChannel: channel, timeoutMs: () => 80 });
    const endpoint = await waitForBridgeEndpoint();

    const body = await postAct(endpoint, {
      session_id: "s-timeout",
      action: "extract_text",
      query: "hi",
    });

    expect(body.ok).toBe(false);
    expect(body.error).toBe("timeout");
    expect(body.request_id).toBe(sent[0]?.request_id);
    expect(typeof body.hint).toBe("string");
  });

  it("explicit extension backend reports extension_offline when the channel has no peer", async () => {
    process.env.AGX_BROWSER_BACKEND = "extension";
    const { channel } = createMockNmChannel({ online: () => false });
    startNearBrowserBridge(() => null, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint();

    const body = await postAct(endpoint, {
      session_id: "s-offline",
      action: "open",
      url: "https://example.com/",
    });

    expect(body.ok).toBe(false);
    expect(body.error).toBe("extension_offline");
    expect(typeof body.request_id).toBe("string");
  });

  it("GET /v1/browser/status reports backend mode and heartbeat liveness", async () => {
    const { channel } = createMockNmChannel({ online: () => true });
    startNearBrowserBridge(() => null, { nmChannel: channel });
    const endpoint = await waitForBridgeEndpoint();

    const status = await getStatus(endpoint);
    expect(status.ok).toBe(true);
    expect(status.backend).toBe("auto");
    expect(status.extension_online).toBe(true);

    process.env.AGX_BROWSER_BACKEND = "extension";
    const asExtension = await getStatus(endpoint);
    expect(asExtension.backend).toBe("extension");

    const unauthorized = await fetch(`${endpoint.base}/v1/browser/status`);
    expect(unauthorized.status).toBe(401);
  });

  // Real unix-socket leg: proves the nm-socket-server action forwarding
  // (ping liveness, sendAct, act_result dispatch) drives the real bridge.
  const itUnix = process.platform === "win32" ? it.skip : it;

  itUnix("routes through a real NM unix socket: ping keeps liveness, act_result settles the bridge", async () => {
    const socketPath = path.join(tmpHome, "browser_bridge_nm.sock");
    const nmServer = await startNmSocketServer(socketPath);
    const fakeExtension = connectFakeExtension(socketPath);
    try {
      fakeExtension.send({ type: "ping", ts: Date.now() });
      await vi.waitFor(() => {
        expect(nmServer.extensionOnline()).toBe(true);
      });

      startNearBrowserBridge(() => null, { nmChannel: nmServer });
      const endpoint = await waitForBridgeEndpoint();

      const status = await getStatus(endpoint);
      expect(status.backend).toBe("auto");
      expect(status.extension_online).toBe(true);

      const pendingResponse = postAct(endpoint, {
        session_id: "s-sock",
        action: "type",
        text: "hello",
        submit: true,
      });
      const act = await fakeExtension.waitForMessage("act");
      expect(act.session_id).toBe("s-sock");
      expect(act.action).toBe("type");
      expect(act.text).toBe("hello");
      fakeExtension.send({
        type: "act_result",
        request_id: act.request_id,
        ok: true,
        action: act.action,
        url: "about:blank",
        text: "[stub]",
        backend: "extension",
      });

      const body = await pendingResponse;
      expect(body.ok).toBe(true);
      expect(body.backend).toBe("extension");
      expect(body.text).toBe("[stub]");
      expect(body.request_id).toBe(act.request_id);
      expect("type" in body).toBe(false); // transport envelope field is stripped
    } finally {
      fakeExtension.destroy();
      await nmServer.close();
    }
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type BridgeEndpoint = { base: string; token: string };

async function waitForBridgeEndpoint(): Promise<BridgeEndpoint> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const endpoint = await probeEndpoint();
    if (endpoint) return endpoint;
    if (Date.now() > deadline) {
      throw new Error("bridge HTTP server did not come up within 5s");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function currentBridgeFiles(): { portFile: string; tokenFile: string } {
  // tmpHome is fixed per test via AGX_HOME; resolve through the same module.
  return {
    portFile: path.join(process.env.AGX_HOME ?? "", "browser_bridge.port"),
    tokenFile: path.join(process.env.AGX_HOME ?? "", "browser_bridge.token"),
  };
}

async function probeEndpoint(): Promise<BridgeEndpoint | null> {
  const { portFile, tokenFile } = currentBridgeFiles();
  try {
    const port = Number(fs.readFileSync(portFile, "utf8").trim());
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (!Number.isInteger(port) || !token) return null;
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/v1/browser/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok ? { base, token } : null;
  } catch {
    return null;
  }
}

async function postAct(
  endpoint: BridgeEndpoint,
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

async function getStatus(endpoint: BridgeEndpoint): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint.base}/v1/browser/status`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
  });
  return (await res.json()) as Record<string, unknown>;
}

type MockNmOptions = {
  online?: () => boolean;
  /** Called on sendAct; reply(row) delivers the extension's act_result. */
  onSend?: (
    message: Record<string, unknown>,
    reply: (row: Record<string, unknown>) => void,
  ) => void;
};

function createMockNmChannel(options: MockNmOptions = {}) {
  const sent: Record<string, unknown>[] = [];
  let actResultHandler: ((row: Record<string, unknown>) => void) | null = null;
  const channel: NmChannel = {
    extensionOnline: () => options.online?.() ?? false,
    sendAct: (message) => {
      sent.push(message);
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
  return { channel, sent };
}

type HostMessage = { channel: string; message: Record<string, unknown> };

function createMockHost() {
  const messages: HostMessage[] = [];
  const host = {
    isDestroyed: () => false,
    send: (channel: string, message: unknown) => {
      messages.push({ channel, message: message as Record<string, unknown> });
    },
  };
  return { webContents: host as unknown as WebContents, messages };
}

async function replyOverIpc(requestId: unknown, row: Record<string, unknown>): Promise<void> {
  const handler = electronMock.ipcHandlers.get("near-browser-act-result");
  if (!handler) throw new Error("near-browser-act-result handler missing");
  await handler(null, { request_id: requestId, ...row });
}

type FakeExtension = {
  send(message: Record<string, unknown>): void;
  waitForMessage(type: string): Promise<Record<string, unknown>>;
  destroy(): void;
};

/** Plays the extension SW + shim: speaks JSONL directly on the NM socket. */
function connectFakeExtension(socketPath: string): FakeExtension {
  const socket = net.connect(socketPath);
  socket.setEncoding("utf8");
  const waiters: Array<{ type: string; resolve: (row: Record<string, unknown>) => void }> = [];
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const index = waiters.findIndex((waiter) => waiter.type === row.type);
      if (index !== -1) {
        waiters.splice(index, 1)[0]!.resolve(row);
      }
    }
  });
  socket.on("error", () => {
    /* server closing during teardown */
  });
  return {
    send: (message) => {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    waitForMessage: (type) =>
      new Promise((resolve) => {
        waiters.push({ type, resolve });
      }),
    destroy: () => socket.destroy(),
  };
}
