import { createHash } from "node:crypto";

export type McpShelfStatus = "draft" | "published";

/** 版本里保存的一条工具。与网关 tools_json 的 snake_case 互转。 */
export interface VersionTool {
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  enabled: boolean;
  sourceOperationId?: string | null;
  metadata: Record<string, unknown>;
}

export interface SurfaceVersion {
  id: string;
  version: number;
  shelfStatus: McpShelfStatus;
  tools: VersionTool[];
  /** 落库形态，可能已是密文信封。 */
  backendConfig: Record<string, unknown>;
  contentHash: string;
}

export interface SurfaceState {
  publishedVersionId: string | null;
  liveTools: VersionTool[];
  liveBackendConfig: Record<string, unknown>;
  versions: SurfaceVersion[];
}

export function versionManaged(
  publishedVersionId: string | null | undefined,
  versionCount: number,
): boolean {
  return Boolean(publishedVersionId) || versionCount > 0;
}

export function nextVersionNumber(existing: number[]): number {
  return existing.reduce((max, value) => Math.max(max, value), 0) + 1;
}

export function toolToStoredJson(tool: VersionTool): Record<string, unknown> {
  return {
    tool_name: tool.toolName,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? {},
    output_schema: tool.outputSchema ?? null,
    enabled: tool.enabled !== false,
    source_operation_id: tool.sourceOperationId ?? null,
    metadata: tool.metadata ?? {},
  };
}

export function storedJsonToTool(raw: unknown): VersionTool {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const output = row.output_schema;
  return {
    toolName: String(row.tool_name ?? ""),
    description: String(row.description ?? ""),
    inputSchema:
      row.input_schema && typeof row.input_schema === "object" && !Array.isArray(row.input_schema)
        ? (row.input_schema as Record<string, unknown>)
        : {},
    outputSchema:
      output && typeof output === "object" && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : null,
    enabled: row.enabled !== false,
    sourceOperationId: row.source_operation_id == null ? null : String(row.source_operation_id),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function surfaceContentHash(tools: VersionTool[], backendConfig: Record<string, unknown>): string {
  const payload = {
    backend_config: backendConfig ?? {},
    tools: tools.map(toolToStoredJson).sort((a, b) => String(a.tool_name).localeCompare(String(b.tool_name))),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function assertCanPublishCurrent(versionCount: number): void {
  if (versionCount > 0) throw new Error("version management is already enabled");
}

export function assertCanPublishDraft(status: McpShelfStatus): void {
  if (status !== "draft") throw new Error("version is not a draft");
}

export function assertCanRollback(status: McpShelfStatus, isCurrent: boolean): void {
  if (status !== "published") throw new Error("version is not published");
  if (isCurrent) throw new Error("version is already current");
}

function enabledTools(tools: VersionTool[]): VersionTool[] {
  return tools.filter((tool) => tool.enabled !== false).sort((a, b) => a.toolName.localeCompare(b.toolName));
}

/** 与网关读路径同一规则：有已发布指针时只看该版本，否则看活表。 */
export function gatewayVisibleTools(state: SurfaceState): VersionTool[] {
  if (state.publishedVersionId) {
    const current = state.versions.find(
      (version) => version.id === state.publishedVersionId && version.shelfStatus === "published",
    );
    return current ? enabledTools(current.tools) : [];
  }
  return enabledTools(state.liveTools);
}

export function applySurfaceWrite(
  state: SurfaceState,
  next: { id: string; tools: VersionTool[]; backendConfig: Record<string, unknown> },
): SurfaceState {
  if (!versionManaged(state.publishedVersionId, state.versions.length)) {
    return {
      ...state,
      liveTools: next.tools,
      liveBackendConfig: next.backendConfig,
    };
  }
  const version = nextVersionNumber(state.versions.map((item) => item.version));
  const draft: SurfaceVersion = {
    id: next.id,
    version,
    shelfStatus: "draft",
    tools: next.tools,
    backendConfig: next.backendConfig,
    contentHash: surfaceContentHash(next.tools, next.backendConfig),
  };
  return { ...state, versions: [...state.versions, draft] };
}

export function applyPublishCurrent(state: SurfaceState, id: string): SurfaceState {
  assertCanPublishCurrent(state.versions.length);
  const published: SurfaceVersion = {
    id,
    version: 1,
    shelfStatus: "published",
    tools: state.liveTools,
    backendConfig: state.liveBackendConfig,
    contentHash: surfaceContentHash(state.liveTools, state.liveBackendConfig),
  };
  return {
    ...state,
    publishedVersionId: id,
    versions: [published],
  };
}

export function applyPublishDraft(state: SurfaceState, versionId: string): SurfaceState {
  const target = state.versions.find((version) => version.id === versionId);
  if (!target) throw new Error("version not found");
  assertCanPublishDraft(target.shelfStatus);
  return {
    ...state,
    publishedVersionId: target.id,
    liveTools: target.tools,
    liveBackendConfig: target.backendConfig,
    versions: state.versions.map((version) =>
      version.id === target.id ? { ...version, shelfStatus: "published" } : version,
    ),
  };
}

export function applyRollback(state: SurfaceState, versionId: string): SurfaceState {
  const target = state.versions.find((version) => version.id === versionId);
  if (!target) throw new Error("version not found");
  assertCanRollback(target.shelfStatus, target.id === state.publishedVersionId);
  return {
    ...state,
    publishedVersionId: target.id,
    liveTools: target.tools,
    liveBackendConfig: target.backendConfig,
  };
}
