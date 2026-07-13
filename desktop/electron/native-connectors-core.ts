export type NativeConnectorAvailability = "available" | "unavailable";

export type TmeetAuthStatus = {
  connected: boolean;
  label: string;
  error?: string;
};

export type GithubAuthStatus = {
  connected: boolean;
  account?: string;
  label: string;
  error?: string;
};

export type FeishuAuthStatus = {
  configured: boolean;
  connected: boolean;
  account?: string;
  label: string;
  error?: string;
};

export type WecomAuthStatus = {
  configured: boolean;
  connected: boolean;
  label: string;
  error?: string;
};

export type StdioMcpEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

const AVAILABLE_CONNECTOR_IDS = new Set([
  "tencent-meeting",
  "tapd",
  "github",
  "feishu",
  "wecom",
]);

const FEISHU_VERIFY_HOST_SUFFIXES = [
  ".feishu.cn",
  ".feishu.com",
  ".larksuite.com",
  ".larkoffice.com",
];

export function nativeConnectorAvailability(connectorId: string): NativeConnectorAvailability {
  return AVAILABLE_CONNECTOR_IDS.has(connectorId) ? "available" : "unavailable";
}

export function parseTmeetAuthStatus(output: string): TmeetAuthStatus {
  if (/\bNot logged in\b/i.test(output)) {
    return { connected: false, label: "可用" };
  }
  if (/\bLogged in\b/i.test(output)) {
    return { connected: true, label: "已连接" };
  }
  return {
    connected: false,
    label: "状态异常",
    error: "无法识别腾讯会议登录状态",
  };
}

export function extractAuthorizationUrl(output: string): string | null {
  const matches = output.match(/https:\/\/meeting\.tencent\.com\/[^\s"'<>]+/giu);
  if (!matches?.length) return null;
  try {
    const url = new URL(matches[0]);
    if (url.protocol !== "https:" || url.hostname !== "meeting.tencent.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseGithubAuthStatus(output: string): GithubAuthStatus {
  const loggedIn = output.match(/Logged in to [\w.-]+ account\s+([\w-]+)/i);
  if (loggedIn) {
    return { connected: true, account: loggedIn[1], label: "已连接" };
  }
  if (/not logged in(to| into)? any GitHub|not logged into/i.test(output)) {
    return { connected: false, label: "可用" };
  }
  return {
    connected: false,
    label: "状态异常",
    error: "无法识别 GitHub 登录状态",
  };
}

export function extractGithubDeviceCode(output: string): string | null {
  const match = output.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
  return match ? match[1].toUpperCase() : null;
}

export function extractGithubDeviceUrl(output: string): string | null {
  const match = output.match(/https:\/\/github\.com\/login\/device[^\s"'<>]*/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    if (!url.pathname.startsWith("/login/device")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Extract the last balanced JSON object from mixed stdout/stderr logs. */
export function extractLastJsonObject(output: string): Record<string, unknown> | null {
  for (let end = output.length - 1; end >= 0; end -= 1) {
    if (output[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = end; i >= 0; i -= 1) {
      const ch = output[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "}") {
        depth += 1;
        continue;
      }
      if (ch === "{") {
        depth -= 1;
        if (depth === 0) {
          const candidate = output.slice(i, end + 1);
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // keep scanning for an earlier balanced object
          }
          break;
        }
      }
    }
  }
  return null;
}

function isFeishuVerifyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return FEISHU_VERIFY_HOST_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

export function parseFeishuAuthStatus(output: string): FeishuAuthStatus {
  const json = extractLastJsonObject(output);
  if (!json) {
    return { configured: false, connected: false, label: "可用" };
  }
  const appId = typeof json.appId === "string" ? json.appId : undefined;
  const configured = Boolean(appId);

  // lark-cli ≥1.0.x puts userName under identities.user; older samples may put it top-level.
  const identities =
    json.identities && typeof json.identities === "object" && !Array.isArray(json.identities)
      ? (json.identities as Record<string, unknown>)
      : null;
  const userIdentity =
    identities?.user && typeof identities.user === "object" && !Array.isArray(identities.user)
      ? (identities.user as Record<string, unknown>)
      : null;
  const nestedName = typeof userIdentity?.userName === "string" ? userIdentity.userName : undefined;
  const topLevelName = typeof json.userName === "string" ? json.userName : undefined;
  const account = nestedName || topLevelName;
  const userReady =
    json.identity === "user" ||
    userIdentity?.status === "ready" ||
    userIdentity?.tokenStatus === "valid" ||
    userIdentity?.available === true;

  if (userReady && account) {
    return {
      configured,
      connected: true,
      account,
      label: "已连接",
    };
  }
  // identity=user but name missing still counts as connected (status probe after login).
  if (json.identity === "user" && configured) {
    return {
      configured,
      connected: true,
      account,
      label: "已连接",
    };
  }
  return {
    configured,
    connected: false,
    label: configured ? "待登录" : "可用",
  };
}

export function extractFeishuDeviceFlow(
  output: string,
): { verificationUrl: string; deviceCode?: string } | null {
  const json = extractLastJsonObject(output);
  if (!json) return null;
  const url = typeof json.verification_url === "string" ? json.verification_url : undefined;
  if (!url || !isFeishuVerifyUrl(url)) return null;
  const deviceCode = typeof json.device_code === "string" ? json.device_code : undefined;
  return { verificationUrl: url, deviceCode };
}

export function buildTapdMcpEntry(
  command: string,
  entrypoint: string,
  accessToken: string,
): StdioMcpEntry {
  return {
    command,
    args: [entrypoint],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      TAPD_ACCESS_TOKEN: accessToken,
      TAPD_API_BASE_URL: "https://api.tapd.cn",
    },
  };
}

export function isTapdValidationSuccess(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as { status?: unknown }).status === 1;
}

export function mergeTapdMcpDocument(
  document: Record<string, unknown>,
  entry: StdioMcpEntry,
): Record<string, unknown> {
  const current =
    document.mcpServers &&
    typeof document.mcpServers === "object" &&
    !Array.isArray(document.mcpServers)
      ? document.mcpServers as Record<string, unknown>
      : {};
  return {
    ...document,
    mcpServers: {
      ...current,
      tapd: entry,
    },
  };
}

export function assertManagedSkillDirectory(
  directoryExists: boolean,
  markerExists: boolean,
): void {
  if (directoryExists && !markerExists) {
    throw new Error("检测到同名用户技能目录，Near 不会覆盖该目录");
  }
}

export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) throw new Error("下载响应缺少内容");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("下载内容超过安全限制");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** npm platform package for @wecom/cli native binary; null = unsupported. */
export function wecomNpmPlatformPackage(platform: string, arch: string): string | null {
  const map: Record<string, string> = {
    "darwin-arm64": "@wecom/cli-darwin-arm64",
    "darwin-x64": "@wecom/cli-darwin-x64",
    "linux-arm64": "@wecom/cli-linux-arm64",
    "linux-x64": "@wecom/cli-linux-x64",
    "win32-x64": "@wecom/cli-win32-x64",
  };
  return map[`${platform}-${arch}`] ?? null;
}

/** Probe stdout is usable when it is non-empty JSON without an `error` field. */
export function isWecomProbeSuccessful(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (!trimmed) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "error" in parsed) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveConnectedConnectorIds(
  tmeetConnected: boolean,
  mcpServers: Array<{ name: string; connected: boolean }>,
  githubConnected = false,
  feishuConnected = false,
  wecomConnected = false,
): Array<"tencent-meeting" | "tapd" | "github" | "feishu" | "wecom"> {
  const ids: Array<"tencent-meeting" | "tapd" | "github" | "feishu" | "wecom"> = [];
  if (tmeetConnected) ids.push("tencent-meeting");
  if (mcpServers.some((server) => server.name === "tapd" && server.connected)) {
    ids.push("tapd");
  }
  if (githubConnected) ids.push("github");
  if (feishuConnected) ids.push("feishu");
  if (wecomConnected) ids.push("wecom");
  return ids;
}
