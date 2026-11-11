/**
 * NM unix socket server — SP1 echo channel upgraded (SP2) to action forwarding.
 *
 * Topology: extension SW ↔ NM(stdio) ↔ scripts/nm-bridge-shim.mjs ↔ THIS
 * server, mounted inside the desktop bridge process. The socket side speaks
 * newline-delimited JSON; the NM 4-byte length-prefix framing exists only on
 * the Chrome↔shim stdio side and the shim converts between the two.
 *
 * Message contract (socket side, one JSON object per line):
 *   extension → desktop:
 *     {type:"ping", ts}          heartbeat; replied with {type:"pong", ts}
 *                                and recorded for extensionOnline()
 *     {type:"act_result", ...}   browser action outcome; delivered to the
 *                                onActResult handler with the transport
 *                                `type` stripped — the bridge settle()s it
 *                                by request_id
 *     {type:"inject_context", session_id?, url, title, text, kind}
 *                              SP5 page-inject (selection / whole page);
 *                              delivered to the onInjectContext handler
 *                              with the transport `type` stripped; the
 *                              bridge replies asynchronously with
 *                              {type:"inject_context_result", ...} via
 *                              sendAct() (same fire-and-forget shape as
 *                              act/act_result)
 *   desktop → extension:
 *     {type:"act", request_id, session_id, action, ...} via sendAct()
 *     {type:"active_session", session_id, ...} via sendAct()
 *                              SP5: latest-active Studio session so the
 *                              extension can cache it for the next inject
 *     {type:"pong", ts, enterprise_deny_domains?} SP6: every pong may carry
 *                              the enterprise browser-deny list (read from
 *                              AGX_HOME config.yaml by the bridge); the
 *                              extension overwrites its synced copy on every
 *                              attach, so config removals propagate too
 *   anything else → echoed verbatim (SP1 shim-test compatibility)
 *
 * Liveness (SP2 §2.3): a live connection whose latest ping is fresher than
 * HEARTBEAT_STALE_MS. The SP1 SW pings on connect and every 1 minute
 * (chrome.alarms), so one missed beat must not flip it offline.
 *
 * Mountable from electron/main.ts or browser-bridge's default NM channel:
 *
 *   const nmServer = await startNmSocketServer();
 *   nmServer.onActResult((row) => { ...settle by row.request_id... });
 *   nmServer.sendAct({ type: "act", request_id, session_id, action, ... });
 *   // on quit: await nmServer.close();
 *
 * Author: Damon Li
 */

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NM_SOCKET_FILENAME = "browser_bridge_nm.sock";
/** Chrome caps one NM message from host at 1MB; enforce the same per-line budget. */
const MAX_LINE_BYTES = 1024 * 1024;
/** SP1 heartbeat cadence: connect-time ping + 1-minute alarms — one missed beat still counts as alive. */
const HEARTBEAT_STALE_MS = 90_000;

export function nmSocketPath(): string {
  const override = String(process.env.AGX_NM_SOCKET_PATH ?? "").trim();
  if (override) {
    return override;
  }
  // Plan-mandated path. Deliberately NOT getAgxHomeDir(): the shim is a
  // standalone node process that only understands ~, and an env-redirected
  // AGX_HOME would desync the two sides of the channel.
  return path.join(os.homedir(), ".agenticx", NM_SOCKET_FILENAME);
}

/** Receives extension act_result rows (request_id + outcome), transport `type` stripped. */
export type NmActResultHandler = (row: Record<string, unknown>) => void;

/** SP5: receives extension inject_context rows ({session_id?, url, title, text, kind}), transport `type` stripped. */
export type NmInjectContextHandler = (row: Record<string, unknown>) => void;

export type NmSocketServerOptions = {
  /**
   * SP6: enterprise browser-deny domains attached to every pong frame
   * (config.yaml → enterprise.browser_deny_domains, resolved by the bridge).
   * Read per pong so config edits propagate without a restart; undefined
   * leaves the pong shape untouched (e2e/mock compatibility).
   */
  enterpriseDenyDomains?: () => string[];
};

export type NmSocketServer = {
  socketPath: string;
  server: net.Server;
  /** Heartbeat liveness: ≥1 live connection whose latest ping is fresh. */
  extensionOnline(): boolean;
  /** Epoch ms of the most recent ping, or null when none arrived yet. */
  lastPingAt(): number | null;
  /** Write one act message to the most recently connected peer; false when nobody is connected. */
  sendAct(message: Record<string, unknown>): boolean;
  /** Set (or clear with null) the handler invoked for act_result rows. */
  onActResult(handler: NmActResultHandler | null): void;
  /** SP5: set (or clear with null) the handler invoked for inject_context rows. */
  onInjectContext(handler: NmInjectContextHandler | null): void;
  close(): Promise<void>;
};

function probeAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

async function ensureBindTarget(socketPath: string): Promise<void> {
  try {
    const stats = fs.lstatSync(socketPath);
    if (!stats.isSocket()) {
      throw new Error(`${socketPath} exists and is not a unix socket; refusing to remove it`);
    }
    if (await probeAlive(socketPath)) {
      throw new Error(`another NM socket server is already listening on ${socketPath}`);
    }
    fs.unlinkSync(socketPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}

export function startNmSocketServer(
  socketPathOverride?: string,
  options?: NmSocketServerOptions,
): Promise<NmSocketServer> {
  const socketPath = socketPathOverride ?? nmSocketPath();
  return new Promise<NmSocketServer>((resolve, reject) => {
    const server = net.createServer();
    const connections = new Set<net.Socket>();
    let latest: net.Socket | null = null;
    let lastPingMs: number | null = null;
    let actResultHandler: NmActResultHandler | null = null;
    let injectContextHandler: NmInjectContextHandler | null = null;

    const handleLine = (line: string): string | null => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // JSONL only; drop malformed lines.
        return null;
      }
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const row = parsed as Record<string, unknown>;
      if (row.type === "ping") {
        lastPingMs = Date.now();
        // Echo protocol: ping → pong with ts passed through (RTT measured by
        // the extension). SP6: attach the enterprise deny list when a
        // provider is wired (undefined key keeps the frame shape unchanged
        // for mocks/e2e harnesses).
        const pong: Record<string, unknown> = { type: "pong", ts: row.ts };
        if (options?.enterpriseDenyDomains) {
          pong.enterprise_deny_domains = options.enterpriseDenyDomains();
        }
        return JSON.stringify(pong);
      }
      if (row.type === "act_result") {
        const { type: _transportType, ...result } = row;
        actResultHandler?.(result);
        return null;
      }
      if (row.type === "inject_context") {
        // SP5 fire-and-forget, mirroring act/act_result: the bridge replies
        // asynchronously with {type:"inject_context_result"} via sendAct().
        const { type: _transportType, ...payload } = row;
        injectContextHandler?.(payload);
        return null;
      }
      // SP1 echo compatibility: unknown messages are echoed verbatim.
      return JSON.stringify(row);
    };

    const handleConnection = (socket: net.Socket): void => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const reply = handleLine(line);
          if (reply !== null) {
            if (!socket.write(`${reply}\n`)) {
              // Backpressure (not expected at these sizes); park until drained.
              socket.pause();
              socket.once("drain", () => socket.resume());
            }
          }
          newline = buffer.indexOf("\n");
        }
        if (buffer.length > MAX_LINE_BYTES) {
          console.warn("[nm-socket-server] oversized line from peer; dropping connection");
          socket.destroy();
        }
      });
      socket.on("error", (err) => {
        console.warn(`[nm-socket-server] socket error: ${err.message}`);
      });
    };

    server.on("connection", (socket) => {
      connections.add(socket);
      latest = socket;
      socket.on("close", () => {
        connections.delete(socket);
        if (latest === socket) {
          const remaining = [...connections];
          latest = remaining.length ? remaining[remaining.length - 1] : null;
        }
      });
      handleConnection(socket);
    });
    ensureBindTarget(socketPath)
      .then(
        () =>
          new Promise<void>((listenResolve, listenReject) => {
            const onError = (err: Error): void => listenReject(err);
            server.once("error", onError);
            server.listen(socketPath, () => {
              server.off("error", onError);
              listenResolve();
            });
          }),
      )
      .then(() => {
        console.log(`[nm-socket-server] listening on ${socketPath}`);
        resolve({
          socketPath,
          server,
          extensionOnline: () =>
            connections.size > 0 &&
            lastPingMs !== null &&
            Date.now() - lastPingMs < HEARTBEAT_STALE_MS,
          lastPingAt: () => lastPingMs,
          sendAct: (message) => {
            if (!latest || latest.destroyed) {
              return false;
            }
            try {
              latest.write(`${JSON.stringify(message)}\n`);
              return true;
            } catch (err) {
              console.warn(
                `[nm-socket-server] sendAct failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              return false;
            }
          },
          onActResult: (handler) => {
            actResultHandler = handler;
          },
          onInjectContext: (handler) => {
            injectContextHandler = handler;
          },
          close: () =>
            new Promise<void>((closeResolve) => {
              for (const connection of connections) connection.destroy();
              connections.clear();
              latest = null;
              server.close(() => {
                closeResolve();
              });
              try {
                fs.unlinkSync(socketPath);
              } catch {
                /* already gone */
              }
            }),
        });
      })
      .catch(reject);
  });
}
