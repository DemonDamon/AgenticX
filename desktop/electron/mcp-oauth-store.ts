/**
 * MCP OAuth 令牌文件（Python agenticx/connectors/oauth.py FileTokenStorage 的只读 / 重置视图）。
 * 路径：~/.agenticx/connectors/oauth/<safe_name>.json（0600），键 tokens / client_info / redirect_port。
 *
 * 安全：只向渲染层返回「是否已授权」布尔值；令牌内容绝不离开主进程，也不写日志。
 * 重置（重新授权）只删 tokens，保留 DCR client_info 与回调端口（已注册的 redirect_uri 不变）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 与 Python `_safe_name` 一致：字母数字与 -_ 保留，其余替换为 _，截断 80，空则 server。 */
export function mcpOauthSafeName(name: string): string {
  const out = Array.from(String(name ?? ""))
    .map((ch) => (/^[\p{L}\p{N}_-]$/u.test(ch) ? ch : "_"))
    .join("")
    .slice(0, 80);
  return out || "server";
}

export function mcpOauthStoreDir(home: string = os.homedir()): string {
  return path.join(home, ".agenticx", "connectors", "oauth");
}

export function mcpOauthTokenPath(name: string, home?: string): string {
  return path.join(mcpOauthStoreDir(home), `${mcpOauthSafeName(name)}.json`);
}

function readStore(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** server 名 → 是否已有 OAuth 令牌（含 access_token）。 */
export function readMcpOauthAuthorized(names: readonly string[], home?: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const data = readStore(mcpOauthTokenPath(name, home));
    const tokens = data?.tokens;
    out[name] = Boolean(
      tokens &&
        typeof tokens === "object" &&
        typeof (tokens as Record<string, unknown>).access_token === "string" &&
        String((tokens as Record<string, unknown>).access_token).length > 0,
    );
  }
  return out;
}

/** 清除令牌以便重新授权（保留 client_info / redirect_port；保持 0600）。返回是否有改动。 */
export function resetMcpOauthTokens(name: string, home?: string): boolean {
  const file = mcpOauthTokenPath(name, home);
  const data = readStore(file);
  if (!data || !("tokens" in data)) return false;
  delete data.tokens;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return true;
}
