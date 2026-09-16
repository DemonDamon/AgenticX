import {
  type ContentBlock,
  appendTextDelta,
  asContentImageUrl,
  asHttpUrl,
  upsertImageBlock,
} from "./content-blocks";

export type ContentBlockSsePayload = {
  type?: string;
  data?: {
    mode?: unknown;
    block?: unknown;
    agent_id?: unknown;
  };
};

function asImageBlock(
  raw: unknown,
  fallbackStatus: "generating" | "ready" | "error" | "cancelled",
): ContentBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (String(row.type ?? "").trim() !== "image") return null;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const statusRaw = String(row.status ?? fallbackStatus).trim();
  const status =
    statusRaw === "generating" ||
    statusRaw === "ready" ||
    statusRaw === "error" ||
    statusRaw === "cancelled"
      ? statusRaw
      : fallbackStatus;
  const block: ContentBlock = {
    type: "image",
    id,
    status,
    source: "tool",
  };
  const path = String(row.path ?? "").trim();
  if (path && !path.startsWith("data:")) block.path = path;
  const url = asContentImageUrl(row.url);
  if (url) block.url = url;
  if (status === "ready" && !block.path && !block.url) return null;
  const sourceUrl = asHttpUrl(row.source_url);
  if (sourceUrl) block.source_url = sourceUrl;
  const kind = String(row.kind ?? "").trim();
  if (kind === "remote" || kind === "generated") block.kind = kind;
  const mime = String(row.mime ?? "").trim();
  if (mime) block.mime = mime;
  const alt = String(row.alt ?? "").trim();
  if (alt) block.alt = alt;
  const error = String(row.error ?? "").trim();
  if (error) block.error = error;
  if (typeof row.width === "number") block.width = row.width;
  if (typeof row.height === "number") block.height = row.height;
  if (status === "generating") block.startedAt = Date.now();
  return block;
}

export function applyContentBlockEvent(
  blocks: ContentBlock[],
  payload: ContentBlockSsePayload,
): ContentBlock[] {
  const mode = String(payload.data?.mode ?? "").trim();
  const incoming = asImageBlock(
    payload.data?.block,
    mode === "start" ? "generating" : "ready",
  );
  if (!incoming) return blocks;
  return upsertImageBlock(blocks, incoming);
}

export function applyTokenDelta(blocks: ContentBlock[], tokenText: string): ContentBlock[] {
  return appendTextDelta(blocks, tokenText);
}
