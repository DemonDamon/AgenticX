/**
 * Outbound fetch for web-search providers.
 *
 * Node/undici global `fetch` does NOT honor HTTP(S)_PROXY / ALL_PROXY.
 * Local Clash/V2Ray style proxies (http://127.0.0.1:7897 + socks5) are required
 * to reach DuckDuckGo from many CN networks; without them Node times out on
 * direct connect and the BFF degrades to 「联网搜索暂不可用」.
 *
 * Strategy: prefer `curl` (inherits proxy env, supports SOCKS) → else HTTP
 * CONNECT via https_proxy/http_proxy → else direct IPv4.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { URL } from "node:url";
import type { Duplex } from "node:stream";

/** Extra `timeoutMs` is honored by curl `--max-time` (AbortSignal alone is not enough). */
export type DirectFetchInit = RequestInit & { timeoutMs?: number };

export type DirectFetch = (input: string | URL, init?: DirectFetchInit) => Promise<Response>;

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([k, v]) => [k, v]));
  }
  return { ...headers };
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new Error("unsupported request body type for directFetch");
}

/** Resolve an HTTP proxy suitable for CONNECT (skips socks://). */
export function resolveHttpProxyUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): URL | null {
  for (const key of ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"]) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveTimeoutMs(init: DirectFetchInit): number {
  if (typeof init.timeoutMs === "number" && Number.isFinite(init.timeoutMs) && init.timeoutMs > 0) {
    return Math.min(Math.floor(init.timeoutMs), 120_000);
  }
  // AbortSignal.timeout() does not expose the original ms. When a signal is present,
  // prefer a short curl --max-time so hung proxy fetches cannot pin Next.js for 20s+.
  if (init.signal) return 8_000;
  return 20_000;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/**
 * curl path must keep the body as raw bytes.
 *
 * Previous implementation did `Buffer.toString("utf8")` before splitting the
 * status trailer — that replaces any byte ≥ 0x80 with U+FFFD, which corrupts
 * PNG/ICO favicons (magic `89 50 4E 47` → `EF BF BD 50 4E 47`). Near Desktop
 * avoids this by fetching binary in the main process and serving data URLs.
 */
async function curlFetchWithBody(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyBuf: Buffer | undefined,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<Response> {
  const parsed = new URL(url);
  const declaredType = (headers["content-type"] ?? headers["Content-Type"] ?? "").toLowerCase();
  // JSON APIs (Bocha, Tavily) reject form-encoded bodies with HTTP 415, so their
  // content-type must survive; only search forms may fall back to curl's `-d` default.
  const isFormBody = !declaredType || declaredType.includes("application/x-www-form-urlencoded");
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-X",
      method,
      "--max-time",
      // curl accepts fractional seconds (e.g. 1.2); keep aligned with AbortSignal budget.
      String(Math.max(0.2, Math.round(timeoutMs) / 1000)),
      "--connect-timeout",
      String(Math.max(0.2, Math.min(5, Math.round(timeoutMs) / 1000 / 2))),
      // Trailer stays ASCII; body stays binary — never decode the whole stdout as utf8.
      "-w",
      "\n__CURL_META__%{http_code}\n%{content_type}",
    ];
    // Local vitals / loopback must not go through Clash etc. (returns 502).
    if (isLoopbackHost(parsed.hostname)) {
      args.push("--noproxy", "*");
    }
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      if (key === "content-length") continue;
      // Let curl set form content-type when using -d; an explicit type + --data-binary
      // has been observed to trigger DuckDuckGo HTTP 202 empty SERP pages.
      if (bodyBuf && isFormBody && key === "content-type") continue;
      args.push("-H", `${k}: ${v}`);
    }
    // Prefer -d (application/x-www-form-urlencoded) over --data-binary for search forms.
    if (bodyBuf) args.push(isFormBody ? "-d" : "--data-binary", "@-");
    args.push(url);

    const child = spawn("curl", args, { env: process.env });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(err);
    };
    const onAbort = () => {
      settleReject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", (err) => settleReject(err instanceof Error ? err : new Error(String(err))));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${Buffer.concat(errChunks).toString("utf8")}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const marker = Buffer.from("\n__CURL_META__");
      const idx = raw.lastIndexOf(marker);
      if (idx < 0) {
        reject(new Error("curl missing status trailer"));
        return;
      }
      const body = raw.subarray(0, idx);
      const metaLines = raw.subarray(idx + marker.length).toString("utf8").trim().split("\n");
      const status = Number((metaLines[0] ?? "").trim());
      const contentType = (metaLines[1] ?? "").trim() || "application/octet-stream";
      if (!Number.isFinite(status) || status <= 0) {
        reject(new Error(`curl invalid status: ${metaLines[0] ?? ""}`));
        return;
      }
      resolve(
        new Response(body, {
          status,
          headers: { "content-type": contentType },
        }),
      );
    });
    if (bodyBuf) {
      child.stdin.write(bodyBuf);
    }
    child.stdin.end();
  });
}

/**
 * curl 是否可用只探测一次并缓存。
 * 运行镜像若不含 curl，每次抓取都 spawn 一个必然 ENOENT 的子进程，
 * 在 deep-research 的并发下会变成 fork 风暴（上百次/轮）。
 */
let curlAvailable: Promise<boolean> | null = null;

export function resetCurlProbeForTests(): void {
  curlAvailable = null;
}

function probeCurl(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn("curl", ["--version"], { env: process.env });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        done(false);
      }, 2_000);
      child.on("error", () => {
        clearTimeout(timer);
        done(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code === 0);
      });
      child.stdout.resume();
      child.stderr.resume();
    } catch {
      done(false);
    }
  });
}

function isCurlAvailable(): Promise<boolean> {
  if (process.env.AGX_DISABLE_CURL_FETCH === "1") return Promise.resolve(false);
  curlAvailable ??= probeCurl();
  return curlAvailable;
}

function connectViaHttpProxy(
  proxy: URL,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port || 80) });
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`proxy connect timeout ${timeoutMs}ms`)), timeoutMs);
    socket.once("error", fail);
    socket.once("connect", () => {
      const auth =
        proxy.username || proxy.password
          ? `Proxy-Authorization: Basic ${Buffer.from(
              `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
            ).toString("base64")}\r\n`
          : "";
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const statusLine = header.split("\r\n")[0] ?? "";
      if (!/^HTTP\/\d\.\d\s+200\b/i.test(statusLine)) {
        fail(new Error(`proxy CONNECT failed: ${statusLine}`));
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners("data");
      const tlsSocket = tls.connect({ socket, servername: targetHost });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", reject);
    });
  });
}

async function httpsViaProxy(
  proxy: URL,
  url: URL,
  method: string,
  headers: Record<string, string>,
  bodyBuf: Buffer | undefined,
  signal?: AbortSignal | null,
): Promise<Response> {
  const socket = await connectViaHttpProxy(proxy, url.hostname, Number(url.port || 443), 15_000);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      socket.destroy();
      reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    // Reuse Node's HTTP parser via https.request over an existing socket.
    const req = https.request({
      createConnection: () => socket as never,
      host: url.hostname,
      servername: url.hostname,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { ...headers, host: url.host },
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(
          new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage,
            headers: res.headers as HeadersInit,
          }),
        );
      });
    });
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function requestDirect(
  url: URL,
  method: string,
  headers: Record<string, string>,
  bodyBuf: Buffer | undefined,
  signal?: AbortSignal | null,
): Promise<Response> {
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      req.destroy();
      reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
        family: 4,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: res.headers as HeadersInit,
            }),
          );
        });
      },
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (!signal) req.setTimeout(20_000, onAbort);
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

export const directFetch: DirectFetch = async (input, init = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const url = typeof input === "string" ? new URL(input) : new URL(input.toString());
  const headers = headersToRecord(init.headers);
  const bodyBuf = await bodyToBuffer(init.body ?? null);
  if (bodyBuf && headers["content-length"] == null && headers["Content-Length"] == null) {
    headers["content-length"] = String(bodyBuf.byteLength);
  }
  const timeoutMs = resolveTimeoutMs(init);

  // 1) curl — best proxy/SOCKS compatibility with shell env
  if (await isCurlAvailable()) {
    try {
      return await curlFetchWithBody(
        url.toString(),
        method,
        headers,
        bodyBuf,
        timeoutMs,
        init.signal,
      );
    } catch {
      // fall through
    }
  }

  // 2) HTTP CONNECT when an http(s) proxy is configured
  const proxy = resolveHttpProxyUrl();
  if (proxy && url.protocol === "https:") {
    try {
      return await httpsViaProxy(proxy, url, method, headers, bodyBuf, init.signal);
    } catch {
      // fall through
    }
  }

  // 3) direct
  return requestDirect(url, method, headers, bodyBuf, init.signal);
};
