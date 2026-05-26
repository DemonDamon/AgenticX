// Proxy-aware fetch for Electron main process.
//
// Node 18+ 自带的 globalThis.fetch（基于 undici）不会读取 HTTP_PROXY / HTTPS_PROXY
// 环境变量。Near 设置页里的「检测密钥/拉取模型/健康检查」等都跑在主进程并直接
// 调用 fetch，所以即使用户已经 export 了代理也会被墙。
//
// 这里提供一个薄封装：当 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 任一被设置时，
// 用 undici 的 ProxyAgent 走代理；NO_PROXY 命中的目标走直连；什么都没设置就
// 等价于直接调用 globalThis.fetch。

import { ProxyAgent, fetch as undiciFetch } from "undici";

function pickEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function getProxyUrl(): string | undefined {
  // 大写优先（POSIX 习惯），其次小写
  return pickEnv("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy");
}

function getNoProxyList(): string[] {
  const raw = pickEnv("NO_PROXY", "no_proxy");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesNoProxy(host: string, noProxy: string[]): boolean {
  if (noProxy.length === 0) return false;
  const h = host.toLowerCase();
  for (const entry of noProxy) {
    if (entry === "*") return true;
    // exact match
    if (h === entry) return true;
    // suffix match (".example.com" 或 "example.com" 命中 sub.example.com)
    const suffix = entry.startsWith(".") ? entry : `.${entry}`;
    if (h.endsWith(suffix)) return true;
  }
  return false;
}

let cachedAgent: { url: string; agent: ProxyAgent } | null = null;

function getProxyAgent(proxyUrl: string): ProxyAgent {
  if (cachedAgent && cachedAgent.url === proxyUrl) return cachedAgent.agent;
  // socks5:// 这类 undici ProxyAgent 不支持，调用方应自行回退
  const agent = new ProxyAgent({ uri: proxyUrl });
  cachedAgent = { url: proxyUrl, agent };
  return agent;
}

function isHttpProxy(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export async function proxyAwareFetch(input: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return fetch(input, init);

  // ProxyAgent 仅支持 http(s) 隧道，socks 等无视
  if (!isHttpProxy(proxyUrl)) return fetch(input, init);

  let host = "";
  try {
    host = new URL(input).hostname;
  } catch {
    return fetch(input, init);
  }

  if (hostMatchesNoProxy(host, getNoProxyList())) {
    return fetch(input, init);
  }

  const agent = getProxyAgent(proxyUrl);
  // Electron 主进程的 globalThis.fetch 实际是 Electron net.fetch（走 Chromium 网络栈），
  // 不会响应 dispatcher 选项。必须直接调用 undici 自己的 fetch 才能让 ProxyAgent 生效。
  // undici 的 RequestInit / Response 与 DOM lib 类型签名不完全一致（Blob / ReadableStream
  // 流路径在 TS lib 里被建模成不同实例），但运行时结构兼容，调用方按标准 Response 使用即可。
  const initWithAgent = { ...(init ?? {}), dispatcher: agent } as unknown as Parameters<typeof undiciFetch>[1];
  const resp = await undiciFetch(input, initWithAgent);
  return resp as unknown as Response;
}

export function logProxyConfig(): void {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return;
  const noProxy = getNoProxyList();
  const usable = isHttpProxy(proxyUrl);
  // eslint-disable-next-line no-console
  console.log(
    `[proxy] main-process fetch using ${proxyUrl}` +
      (noProxy.length ? ` (NO_PROXY=${noProxy.join(",")})` : "") +
      (usable ? "" : " [unsupported scheme, fallback to direct]"),
  );
}
