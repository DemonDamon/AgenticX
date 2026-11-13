#!/usr/bin/env node
/**
 * SP1 · NM Channel Spike — Native Messaging host shim.
 *
 * Chrome spawns this script once per runtime.connectNative() port and keeps it
 * alive until the port is destroyed. Wire format on the Chrome side
 * (https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging):
 *   - each message is UTF-8 JSON, prefixed with a 32-bit message length in
 *     native byte order (little-endian on macOS x64/arm64);
 *   - one message from host → Chrome is capped at 1MB, Chrome → host at 64MiB;
 *   - only protocol frames may go to stdout — debug output goes to stderr;
 *   - argv[0] extra arg is the caller origin (chrome-extension://<id>/).
 * Socket side (~/.agenticx/browser_bridge_nm.sock): newline-delimited JSON.
 *
 * Lifecycle: stdin EOF (Chrome closed the port) or socket loss ⇒ exit now.
 * The extension's onDisconnect/heartbeat logic triggers a fresh shim spawn on
 * reconnect, so no in-process resurrection is needed here.
 *
 * Author: Damon Li
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SOCKET_PATH =
  String(process.env.AGX_NM_SOCKET_PATH ?? "").trim() ||
  path.join(os.homedir(), ".agenticx", "browser_bridge_nm.sock");
/** Chrome → host frame cap (64MiB per NM protocol); larger means the stream is corrupt. */
const MAX_IN_BYTES = 64 * 1024 * 1024;
/** host → Chrome frame cap (1MB per NM protocol). */
const MAX_OUT_BYTES = 1024 * 1024;
const CONNECT_RETRY_MS = 300;
const CONNECT_RETRIES = 10;

function log(...args) {
  process.stderr.write(`[agx-nm-shim] ${args.join(" ")}\n`);
}

let exiting = false;
let socket = null;
let socketReady = false;
let socketBuffer = "";
let stdinBuffer = Buffer.alloc(0);
/** Lines arriving before the socket connects (flushed on connect). */
const pendingLines = [];

function exit(code) {
  exiting = true;
  if (socket) {
    socket.destroy();
    socket = null;
  }
  process.exit(code);
}

function fail(reason) {
  log(reason);
  exit(1);
}

function writeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  if (payload.length > MAX_OUT_BYTES) {
    log(`dropping oversized outbound message (${payload.length} bytes)`);
    return;
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function forwardLine(line) {
  if (!socket || !socketReady) {
    pendingLines.push(line);
    return;
  }
  socket.write(`${line}\n`);
}

process.stdin.on("data", (chunk) => {
  if (exiting) return;
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  for (;;) {
    if (stdinBuffer.length < 4) break;
    const declared = stdinBuffer.readUInt32LE(0);
    if (declared > MAX_IN_BYTES) {
      fail(`oversized inbound frame (${declared} bytes) — stream corrupt`);
      return;
    }
    if (stdinBuffer.length < 4 + declared) break;
    const payload = stdinBuffer.subarray(4, 4 + declared);
    stdinBuffer = stdinBuffer.subarray(4 + declared);
    const line = payload.toString("utf8").trim();
    if (line) forwardLine(line);
  }
});
process.stdin.on("end", () => {
  log("stdin EOF — Chrome closed the port");
  exit(0);
});
process.stdin.on("error", (err) => fail(`stdin error: ${err.message}`));
process.stdin.resume();

function connectSocket(attempt = 0) {
  if (exiting) return;
  const pending = net.connect(SOCKET_PATH);
  socket = pending;
  pending.once("connect", () => {
    if (exiting || socket !== pending) return;
    socketReady = true;
    log(`connected to ${SOCKET_PATH}`);
    if (pendingLines.length) {
      const backlog = pendingLines.splice(0, pendingLines.length);
      for (const line of backlog) pending.write(`${line}\n`);
    }
  });
  pending.on("data", (chunk) => {
    if (socket !== pending || exiting) return;
    socketBuffer += chunk.toString("utf8");
    let newline = socketBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = socketBuffer.slice(0, newline).trim();
      socketBuffer = socketBuffer.slice(newline + 1);
      newline = socketBuffer.indexOf("\n");
      if (!line) continue;
      try {
        writeFrame(JSON.parse(line));
      } catch {
        log(`ignoring non-JSON line from desktop (${line.length} bytes)`);
      }
    }
  });
  pending.once("error", (err) => {
    if (exiting || socket !== pending) return;
    socket = null;
    socketReady = false;
    if (err && (err.code === "ENOENT" || err.code === "ECONNREFUSED") && attempt < CONNECT_RETRIES) {
      // Desktop may be mid-boot; retry briefly before dying so a race between
      // Chrome spawn and desktop startup doesn't burn a reconnect cycle.
      setTimeout(() => connectSocket(attempt + 1), CONNECT_RETRY_MS);
      return;
    }
    fail(`socket error (${err.code ?? err.message}) — desktop side unavailable at ${SOCKET_PATH}`);
  });
  pending.once("close", () => {
    if (!exiting && socket === pending) {
      fail("socket closed by desktop");
    }
  });
}

log(`origin=${process.argv[2] ?? "unknown"} socket=${SOCKET_PATH}`);
connectSocket();
