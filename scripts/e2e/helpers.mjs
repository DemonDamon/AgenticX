/**
 * Shared helpers for SP1 NM spike e2e scripts.
 * Mirrors desktop/electron/nm-socket-server.ts (socket side) and the Chrome NM
 * stdio framing (4-byte little-endian length prefix + UTF-8 JSON).
 *
 * Author: Damon Li
 */

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NM_HOST_NAME = "com.agenticx.bridge";
/** Locked by the fixed "key" in extension/manifest.json — recorded in the SP1 plan. */
export const SPIKE_EXTENSION_ID = "kajgkmohjdflaidencpfmebbjibfieka";

/** Parse a URL and return its hostname, or null when unparsable. E2e
 *  assertions compare hosts this way instead of raw substring matching
 *  (CodeQL: incomplete URL substring sanitization). */
export function urlHostname(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return null;
  }
}

/** True when some whitespace-separated token of `text` parses to exactly
 *  `host`. Tokens without a scheme are matched by their leading ASCII
 *  domain run, so glued punctuation (e.g. "mail.qq.com（记录在案…）")
 *  still yields the bare host. */
export function textHasHost(text, host) {
  return String(text)
    .split(/\s+/)
    .some((token) => {
      if (token.includes("://")) return urlHostname(token) === host;
      const m = token.match(/^[A-Za-z0-9][A-Za-z0-9.-]*/);
      return m ? urlHostname(`https://${m[0]}`) === host : false;
    });
}

export function nmSocketPath() {
  const override = String(process.env.AGX_NM_SOCKET_PATH ?? "").trim();
  return override || path.join(os.homedir(), ".agenticx", "browser_bridge_nm.sock");
}

/** JSONL echo server: `{type:"ping",ts}` → `{type:"pong",ts}`, other messages echoed verbatim. */
export function startEchoServer(socketPath) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.on("connection", (socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          let reply = null;
          try {
            const parsed = JSON.parse(line);
            reply =
              parsed && parsed.type === "ping"
                ? JSON.stringify({ type: "pong", ts: parsed.ts })
                : JSON.stringify(parsed);
          } catch {
            reply = null;
          }
          if (reply !== null) socket.write(`${reply}\n`);
        }
      });
      socket.on("error", () => socket.destroy());
    });
    try {
      fs.unlinkSync(socketPath);
    } catch {
      /* absent is fine */
    }
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        server,
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => {
              try {
                fs.unlinkSync(socketPath);
              } catch {
                /* already gone */
              }
              closeResolve();
            });
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/** NM stdio framing (Chrome doc): 32-bit little-endian length prefix + UTF-8 JSON. */
export function encodeNmFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** Incremental decoder for length-prefixed NM frames. push(chunk) → decoded objects. */
export function createNmFrameDecoder() {
  let pending = Buffer.alloc(0);
  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      const messages = [];
      for (;;) {
        if (pending.length < 4) break;
        const size = pending.readUInt32LE(0);
        if (size > 64 * 1024 * 1024) throw new Error(`corrupt NM frame: ${size} bytes`);
        if (pending.length < 4 + size) break;
        messages.push(JSON.parse(pending.subarray(4, 4 + size).toString("utf8")));
        pending = pending.subarray(4 + size);
      }
      return messages;
    },
  };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until fn() returns truthy (10ms tick), or reject after timeoutMs. */
export async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout after ${timeoutMs}ms waiting for ${label}`);
    await delay(10);
  }
}
