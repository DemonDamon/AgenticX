import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { fstatSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { directFetch, resetCurlProbeForTests } from "./direct-fetch";

function makeFailingSpawn() {
  return {
    stdout: { on: vi.fn(), resume: vi.fn() },
    stderr: { on: vi.fn(), resume: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === "error") {
        queueMicrotask(() => cb(new Error("ENOENT")));
      }
      return undefined;
    },
  };
}

function makeSpawnedProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("directFetch curl probe", () => {
  beforeEach(() => {
    resetCurlProbeForTests();
    spawnMock.mockReset();
    delete process.env.AGX_DISABLE_CURL_FETCH;
  });

  afterEach(() => {
    resetCurlProbeForTests();
    delete process.env.AGX_DISABLE_CURL_FETCH;
  });

  it("skips curl spawn entirely when AGX_DISABLE_CURL_FETCH=1", async () => {
    process.env.AGX_DISABLE_CURL_FETCH = "1";
    await expect(directFetch("http://127.0.0.1:1/probe")).rejects.toBeTruthy();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("caches a failed curl probe so subsequent fetches do not re-spawn", async () => {
    spawnMock.mockImplementation(() => makeFailingSpawn());

    for (let i = 0; i < 5; i += 1) {
      await expect(directFetch("http://127.0.0.1:1/probe")).rejects.toBeTruthy();
    }

    // One probe spawn only; curl fetch path is never entered after a failed probe.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(["--version"]);
  });

  it("passes secret headers on stdin and the body through an unlinked regular fd", async () => {
    const secret = "tenant-secret-must-not-enter-argv";
    const requestBody = JSON.stringify({ query: "table 8" });
    let curlArgs: string[] = [];
    let inheritedFd: number | undefined;
    let inheritedMode = 0;
    let inheritedLinks = -1;
    let inheritedBody = "";
    let headerInput = "";

    spawnMock.mockImplementation((_command, args: string[], options?: { stdio?: unknown[] }) => {
      const child = makeSpawnedProcess();
      if (args[0] === "--version") {
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      curlArgs = args;
      inheritedFd = options?.stdio?.[3] as number | undefined;
      expect(typeof inheritedFd).toBe("number");
      const stat = fstatSync(inheritedFd!);
      expect(stat.isFile()).toBe(true);
      inheritedMode = stat.mode & 0o777;
      inheritedLinks = stat.nlink;
      inheritedBody = readFileSync(inheritedFd!, "utf8");
      child.stdin.on("data", (chunk) => {
        headerInput += chunk.toString("utf8");
      });
      queueMicrotask(() => {
        child.stdout.end('{"ok":true}\n__CURL_META__200\napplication/json');
        child.emit("close", 0);
      });
      return child;
    });

    const response = await directFetch("http://127.0.0.1:1/v1/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: requestBody,
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(curlArgs).toContain("@-");
    expect(curlArgs).toContain("@/dev/fd/3");
    expect(curlArgs.join(" ")).not.toContain(secret);
    expect(headerInput).toContain(`authorization: Bearer ${secret}`);
    expect(headerInput).toContain("content-type: application/json");
    expect(inheritedMode).toBe(0o600);
    expect(inheritedLinks).toBe(0);
    expect(inheritedBody).toBe(requestBody);
    expect(() => fstatSync(inheritedFd!)).toThrow();
  });
});
