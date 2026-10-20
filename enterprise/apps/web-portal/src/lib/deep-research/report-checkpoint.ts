import { gunzipSync, gzipSync } from "node:zlib";
import type { ArtifactRecord, ArtifactStore } from "./artifact-store";
import { MAX_ARTIFACT_BYTES } from "./artifact-store";
import type { DeliveryPrefs } from "./delivery-prefs";
import type { Citation } from "./registry";
import type { ReportOutline } from "./report-writer";

export const REPORT_CHECKPOINT_MIME = "application/vnd.agenticx.research-checkpoint+gzip";
const MAX_CHECKPOINT_JSON_BYTES = 4 * 1024 * 1024;

export type CheckpointMessage = {
  role: string;
  content?: string | null;
};

export type ReportCheckpoint = {
  version: 1;
  sourceRunId: string;
  nextRunId: string;
  topic: string;
  messages?: CheckpointMessage[];
  writingRequirements?: string;
  model: string;
  provider: string;
  outline: ReportOutline;
  completed: Array<{ section: ReportOutline["sections"][number]; body: string }>;
  sectionEvidence: string[];
  citations: Citation[];
  deliveryPrefs: DeliveryPrefs;
  stats: {
    queriesPlanned: number;
    urlsDiscovered: number;
    sourcesSelected: number;
    pagesFetched: number;
  };
  createdAt: string;
};

export function reportCheckpointPath(runId: string): string {
  return `research/${runId}/report-checkpoint.gz`;
}

function isCheckpointMessage(message: CheckpointMessage): boolean {
  if (!message || !["user", "assistant", "system"].includes(message.role)) return false;
  const content = message.content;
  return content == null || typeof content === "string";
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function encodeReportCheckpoint(checkpoint: ReportCheckpoint): string {
  const raw = Buffer.from(JSON.stringify(checkpoint));
  if (raw.byteLength > MAX_CHECKPOINT_JSON_BYTES) throw new Error("research checkpoint too large");
  const compressed = gzipSync(raw);
  const encoded = compressed.toString("base64");
  if (Buffer.byteLength(encoded) > MAX_ARTIFACT_BYTES) throw new Error("research checkpoint too large");
  return encoded;
}

export function decodeReportCheckpoint(record: ArtifactRecord, runId: string): ReportCheckpoint {
  if (
    record.runId !== runId ||
    record.mimeType !== REPORT_CHECKPOINT_MIME ||
    record.path !== reportCheckpointPath(runId)
  ) {
    throw new Error("invalid research checkpoint");
  }
  const compressed = Buffer.from(record.content, "base64");
  if (compressed.byteLength > MAX_ARTIFACT_BYTES) throw new Error("research checkpoint too large");
  const value = JSON.parse(
    gunzipSync(compressed, { maxOutputLength: MAX_CHECKPOINT_JSON_BYTES }).toString(),
  ) as ReportCheckpoint & { attachmentRoute?: unknown };
  const stats = value.stats;
  const sections = value.outline?.sections;
  if (
    value.version !== 1 ||
    value.sourceRunId !== runId ||
    typeof value.nextRunId !== "string" ||
    !value.nextRunId ||
    value.nextRunId === runId ||
    typeof value.topic !== "string" ||
    typeof value.model !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.writingRequirements !== undefined && typeof value.writingRequirements !== "string") ||
    (value.messages !== undefined &&
      (!Array.isArray(value.messages) || !value.messages.every(isCheckpointMessage))) ||
    !Array.isArray(sections) ||
    sections.length === 0 ||
    !sections.every((section) => section && typeof section.id === "string" && typeof section.title === "string") ||
    !Array.isArray(value.completed) ||
    value.completed.length > sections.length ||
    !value.completed.every(
      (entry, index) =>
        typeof entry?.body === "string" && entry.section?.id === sections[index]?.id,
    ) ||
    !Array.isArray(value.sectionEvidence) ||
    value.sectionEvidence.length !== sections.length ||
    !value.sectionEvidence.every((entry) => typeof entry === "string") ||
    !Array.isArray(value.citations) ||
    !value.deliveryPrefs ||
    typeof value.deliveryPrefs.format !== "string" ||
    !Array.isArray(value.deliveryPrefs.shapes) ||
    !stats ||
    !isFiniteCount(stats.queriesPlanned) ||
    !isFiniteCount(stats.urlsDiscovered) ||
    !isFiniteCount(stats.sourcesSelected) ||
    !isFiniteCount(stats.pagesFetched)
  ) {
    throw new Error("invalid research checkpoint");
  }
  return {
    version: 1,
    sourceRunId: value.sourceRunId,
    nextRunId: value.nextRunId,
    topic: value.topic,
    ...(value.messages ? { messages: value.messages } : {}),
    ...(value.writingRequirements !== undefined ? { writingRequirements: value.writingRequirements } : {}),
    model: value.model,
    provider: value.provider,
    outline: value.outline,
    completed: value.completed,
    sectionEvidence: value.sectionEvidence,
    citations: value.citations,
    deliveryPrefs: {
      format: value.deliveryPrefs.format,
      shapes: value.deliveryPrefs.shapes,
    },
    stats: {
      queriesPlanned: stats.queriesPlanned,
      urlsDiscovered: stats.urlsDiscovered,
      sourcesSelected: stats.sourcesSelected,
      pagesFetched: stats.pagesFetched,
    },
    createdAt: value.createdAt,
  };
}

export async function saveReportCheckpoint(
  store: ArtifactStore,
  scope: { tenantId: string; userId: string; sessionId: string },
  checkpoint: ReportCheckpoint,
): Promise<ArtifactRecord> {
  return store.write({
    tenantId: scope.tenantId,
    userId: scope.userId,
    sessionId: scope.sessionId,
    runId: checkpoint.sourceRunId,
    path: reportCheckpointPath(checkpoint.sourceRunId),
    title: "报告续写检查点",
    kind: "other",
    mimeType: REPORT_CHECKPOINT_MIME,
    content: encodeReportCheckpoint(checkpoint),
  });
}

export async function loadReportCheckpoint(
  store: ArtifactStore,
  scope: { tenantId: string; userId: string },
  runId: string,
): Promise<ReportCheckpoint | null> {
  const records = await store.listByRun(scope.tenantId, scope.userId, runId);
  const record = records.find(
    (item) => item.path === reportCheckpointPath(runId) && item.mimeType === REPORT_CHECKPOINT_MIME,
  );
  if (!record) return null;
  return decodeReportCheckpoint(record, runId);
}
