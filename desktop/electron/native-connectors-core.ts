export type NativeConnectorAvailability = "available" | "unavailable";

export type TmeetAuthStatus = {
  connected: boolean;
  label: string;
  error?: string;
};

export type StdioMcpEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

const AVAILABLE_CONNECTOR_IDS = new Set(["tencent-meeting", "tapd"]);

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

export function resolveConnectedConnectorIds(
  tmeetConnected: boolean,
  mcpServers: Array<{ name: string; connected: boolean }>,
): Array<"tencent-meeting" | "tapd"> {
  const ids: Array<"tencent-meeting" | "tapd"> = [];
  if (tmeetConnected) ids.push("tencent-meeting");
  if (mcpServers.some((server) => server.name === "tapd" && server.connected)) {
    ids.push("tapd");
  }
  return ids;
}
