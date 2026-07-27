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

export type DirectFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

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

function timeoutMsFromSignal(signal?: AbortSignal | null): number {
  // AbortSignal.timeout(n) doesn't expose remaining ms; use a sane default.
  return signal ? 20_000 : 20_000;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function curlFetchWithBody(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyBuf: Buffer | undefined,
  timeoutMs: number,
): Promise<Response> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-X",
      method,
      "--max-time",
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      "-w",
      "\n__CURL_STATUS__%{http_code}",
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
      if (bodyBuf && key === "content-type") continue;
      args.push("-H", `${k}: ${v}`);
    }
    // Prefer -d (application/x-www-form-urlencoded) over --data-binary for search forms.
    if (bodyBuf) args.push("-d", "@-");
    args.push(url);

    const child = spawn("curl", args, { env: process.env });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${Buffer.concat(errChunks).toString("utf8")}`));
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const marker = "\n__CURL_STATUS__";
      const idx = text.lastIndexOf(marker);
      if (idx < 0) {
        reject(new Error("curl missing status trailer"));
        return;
      }
      const body = text.slice(0, idx);
      const status = Number(text.slice(idx + marker.length).trim());
      resolve(new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } }));
    });
    if (bodyBuf) {
      child.stdin.write(bodyBuf);
    }
    child.stdin.end();
  });
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
  const timeoutMs = timeoutMsFromSignal(init.signal);

  // 1) curl — best proxy/SOCKS compatibility with shell env
  try {
    return await curlFetchWithBody(url.toString(), method, headers, bodyBuf, timeoutMs);
  } catch {
    // fall through
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
