export type CreateRunBranchInput = {
  sourceEventId: string;
  instruction: string;
  provider?: string;
  model?: string;
};

export type BranchEffectWarning = {
  effectClass: "external_write" | "unknown";
  toolName: string;
  count: number;
};

export type BranchEventSummary = {
  eventId: string;
  seq: number;
  type: string;
  title: string;
};

export type CreateRunBranchResult = {
  sessionId: string;
  sourceRunId: string;
  resolvedCheckpointSeq: number;
  requestedEvent: BranchEventSummary;
  resolvedEvent: BranchEventSummary;
  lineage: Record<string, unknown>;
  warnings: BranchEffectWarning[];
  instruction: string;
  provider?: string;
  model?: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class RunBranchRequestError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "RunBranchRequestError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function eventSummary(value: unknown): BranchEventSummary {
  const row = record(value);
  const seq = typeof row?.seq === "number" ? row.seq : Number.NaN;
  const eventId = text(row?.event_id);
  if (!row || !eventId || !Number.isInteger(seq) || seq < 1) {
    throw new RunBranchRequestError("invalid_branch_response", "Invalid branch event response");
  }
  return {
    eventId,
    seq,
    type: text(row.type) || "unknown",
    title: text(row.title),
  };
}

function effectWarnings(value: unknown): BranchEffectWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const effectClass = text(row?.effect_class);
    const count = typeof row?.count === "number" ? row.count : 0;
    if (
      !row
      || (effectClass !== "external_write" && effectClass !== "unknown")
      || !Number.isInteger(count)
      || count < 1
    ) return [];
    return [{
      effectClass,
      toolName: text(row.tool_name) || "unknown_tool",
      count,
    }];
  });
}

export async function createRunBranch(
  apiBase: string,
  apiToken: string,
  runId: string,
  input: CreateRunBranchInput,
  fetcher: FetchLike = fetch,
): Promise<CreateRunBranchResult> {
  const response = await fetcher(
    `${apiBase.replace(/\/$/, "")}/api/runs/${encodeURIComponent(runId)}/branches`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": apiToken,
      },
      body: JSON.stringify({
        source_event_id: input.sourceEventId,
        instruction: input.instruction,
        provider: input.provider || null,
        model: input.model || null,
      }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  const root = record(payload);
  if (!response.ok) {
    const detail = record(root?.detail);
    throw new RunBranchRequestError(
      text(detail?.code) || `http_${response.status}`,
      text(detail?.detail) || response.statusText || "Branch creation failed",
    );
  }
  const sessionId = text(root?.session_id);
  const sourceRunId = text(root?.source_run_id);
  const resolvedCheckpointSeq = typeof root?.resolved_checkpoint_seq === "number"
    ? root.resolved_checkpoint_seq
    : Number.NaN;
  if (!sessionId || !sourceRunId || !Number.isInteger(resolvedCheckpointSeq)) {
    throw new RunBranchRequestError("invalid_branch_response", "Missing branch response metadata");
  }
  return {
    sessionId,
    sourceRunId,
    resolvedCheckpointSeq,
    requestedEvent: eventSummary(root?.requested_event),
    resolvedEvent: eventSummary(root?.resolved_event),
    lineage: record(root?.lineage) ?? {},
    warnings: effectWarnings(root?.warnings),
    instruction: text(root?.instruction),
    ...(text(root?.provider) ? { provider: text(root?.provider) } : {}),
    ...(text(root?.model) ? { model: text(root?.model) } : {}),
  };
}
