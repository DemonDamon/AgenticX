#!/usr/bin/env node
/**
 * SP1 e2e · shim ↔ socket server link test.
 *
 * Boots a JSONL echo server on a throwaway socket, spawns
 * scripts/nm-bridge-shim.mjs with piped stdio, and drives NM frames through it:
 *   - phase 1: 5 sequential ping→pong round trips, assert reply shape and
 *     wall-clock RTT < 100ms;
 *   - phase 2: non-ping message must be echoed verbatim;
 *   - phase 3: stdin EOF must make the shim exit cleanly.
 * Exit code: 0 PASS / 1 FAIL.
 *
 * Author: Damon Li
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  encodeNmFrame,
  createNmFrameDecoder,
  startEchoServer,
  delay,
  waitFor,
  SPIKE_EXTENSION_ID,
} from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const SOCKET_PATH = "/tmp/agx-nm-shim-e2e.sock";
const RTT_BUDGET_MS = 100;

async function main() {
  if (!fs.existsSync(SHIM_PATH)) {
    throw new Error(`shim not found: ${SHIM_PATH}`);
  }
  const server = await startEchoServer(SOCKET_PATH);
  const shim = spawn(process.execPath, [SHIM_PATH, `chrome-extension://${SPIKE_EXTENSION_ID}/`], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AGX_NM_SOCKET_PATH: SOCKET_PATH },
  });

  const decoder = createNmFrameDecoder();
  const replies = [];
  const stderrChunks = [];
  let shimExit = null;
  shim.stdout.on("data", (chunk) => replies.push(...decoder.push(chunk)));
  shim.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  shim.on("exit", (code) => {
    shimExit = code;
  });

  let failures = 0;
  const fail = (message) => {
    console.error(`FAIL ${message}`);
    failures += 1;
  };

  try {
    // ---- phase 1: ping→pong round trips ----
    for (let i = 0; i < 5; i += 1) {
      const ts = Date.now();
      const before = replies.length;
      shim.stdin.write(encodeNmFrame({ type: "ping", ts }));
      await waitFor(() => replies.length > before, 2000, `pong for ping #${i}`);
      const reply = replies.shift();
      const rtt = Date.now() - ts;
      if (!reply || reply.type !== "pong" || reply.ts !== ts) {
        fail(`ping #${i}: expected {type:"pong",ts:${ts}}, got ${JSON.stringify(reply)}`);
      } else if (rtt >= RTT_BUDGET_MS) {
        fail(`ping #${i}: rtt ${rtt}ms >= ${RTT_BUDGET_MS}ms`);
      } else {
        console.log(`PASS ping #${i}: pong rtt=${rtt}ms (ts=${ts})`);
      }
      await delay(20);
    }

    // ---- phase 2: non-ping echo ----
    const probe = { type: "hello", n: 42 };
    const before = replies.length;
    shim.stdin.write(encodeNmFrame(probe));
    await waitFor(() => replies.length > before, 2000, "echo for hello");
    const echoed = replies.shift();
    if (JSON.stringify(echoed) !== JSON.stringify(probe)) {
      fail(`hello echo: expected ${JSON.stringify(probe)}, got ${JSON.stringify(echoed)}`);
    } else {
      console.log("PASS non-ping message echoed verbatim");
    }

    // ---- phase 3: stdin EOF → clean exit ----
    shim.stdin.end();
    await waitFor(() => shimExit !== null, 5000, "shim exit");
    if (shimExit !== 0) {
      fail(`shim exit code ${shimExit} (expected 0)`);
    } else {
      console.log("PASS shim exits cleanly on stdin EOF");
    }
  } finally {
    if (shimExit === null) shim.kill("SIGKILL");
    await server.close();
  }

  if (stderrChunks.length) {
    process.stderr.write(`--- shim stderr ---\n${Buffer.concat(stderrChunks).toString("utf8")}`);
  }
  console.log(failures ? `\nRESULT: FAIL (${failures} failures)` : "\nRESULT: PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  process.exit(1);
});
