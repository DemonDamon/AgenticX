export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      id: string;
      status: "generating" | "ready" | "error" | "cancelled";
      path?: string;
      url?: string;
      source_url?: string;
      kind?: "remote" | "generated";
      mime?: string;
      alt?: string;
      width?: number;
      height?: number;
      source?: "tool";
      error?: string;
      startedAt?: number;
    };

export type ImageContentBlock = Extract<ContentBlock, { type: "image" }>;

export function upsertImageBlock(blocks: ContentBlock[], incoming: ContentBlock): ContentBlock[] {
  if (incoming.type !== "image" || !incoming.id) {
    return [...blocks, incoming];
  }
  const idx = blocks.findIndex((b) => b.type === "image" && b.id === incoming.id);
  if (idx < 0) {
    return [...blocks, incoming];
  }
  const prev = blocks[idx];
  if (prev.type !== "image") {
    return [...blocks, incoming];
  }
  const next = [...blocks];
  next[idx] = {
    ...prev,
    ...incoming,
    id: incoming.id,
    type: "image",
    startedAt: incoming.startedAt ?? prev.startedAt,
  };
  return next;
}

export function appendTextDelta(blocks: ContentBlock[], delta: string): ContentBlock[] {
  if (!delta) return blocks;
  const last = blocks[blocks.length - 1];
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", text: last.text + delta }];
  }
  return [...blocks, { type: "text", text: delta }];
}

export function projectContentFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function markGeneratingBlocksCancelled(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((b) =>
    b.type === "image" && b.status === "generating" ? { ...b, status: "cancelled" } : b,
  );
}

export function hasImageBlock(blocks: ContentBlock[] | undefined): boolean {
  return Boolean(blocks?.some((b) => b.type === "image"));
}

export function readyLightboxImages(blocks: ContentBlock[] | undefined): ImageContentBlock[] {
  const out: ImageContentBlock[] = [];
  const seen = new Set<string>();
  for (const block of blocks ?? []) {
    if (block.type !== "image" || block.status !== "ready" || !block.id) continue;
    if (seen.has(block.id)) continue;
    const path = String(block.path ?? "").trim();
    const url = String(block.url ?? "").trim();
    const hasUrl = url.startsWith("http://") || url.startsWith("https://");
    if (!path && !hasUrl) continue;
    seen.add(block.id);
    out.push(block);
  }
  return out;
}

export function collectTurnLightboxImages<
  T extends { id: string; role: string; blocks?: ContentBlock[] },
>(messages: T[], assistantId: string): ImageContentBlock[] {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return [];
  let start = 0;
  for (let i = idx; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      start = i + 1;
      break;
    }
  }
  const out: ImageContentBlock[] = [];
  const seen = new Set<string>();
  for (let i = start; i < messages.length; i += 1) {
    const row = messages[i];
    if (!row || row.role === "user") break;
    if (row.role !== "assistant") continue;
    for (const block of readyLightboxImages(row.blocks)) {
      if (seen.has(block.id)) continue;
      seen.add(block.id);
      out.push(block);
    }
  }
  return out;
}

/** Listing-page thumbs such as `.thumb.400_0.jpeg` / `.thumb.100_100_c.jpg`. */
const REMOTE_THUMB_SUFFIX = /\.thumb\.\d+_\d+(?:_[A-Za-z0-9]+)?\.(jpe?g|png|webp|gif)$/i;
const TINY_THUMB = /\.thumb\.(\d+)_\d+/i;
const JUNK_NAME = /(?:favicon|sprite|pixel|spacer|1x1|qrcode|qr[-_]code|app[-_]download)/i;
const JUNK_PATH_MARKERS = [
  "/uploads/ops/",
  "/uploads/avatar/",
  "/uploads/people/",
  "/avatar/",
  "/avatars/",
  "/banner/",
  "/banners/",
  "/promo/",
  "/advert",
  "/ads/",
  "/favicon",
  "/sprite",
  "/qrcode",
  "/qr-code",
  "/qr_code",
];

export function upgradeRemoteImageUrl(url: string): string {
  const text = String(url ?? "").trim();
  if (!text) return "";
  const upgraded = text.replace(REMOTE_THUMB_SUFFIX, ".$1");
  return upgraded.length > 2048 ? text : upgraded;
}

export function isJunkRemoteImageUrl(url: string): boolean {
  const text = String(url ?? "").trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  if (JUNK_PATH_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (JUNK_NAME.test(lower)) return true;
  const tiny = TINY_THUMB.exec(lower);
  if (tiny && Number(tiny[1]) <= 160) return true;
  return false;
}

export function asHttpUrl(raw: unknown): string | undefined {
  const url = String(raw ?? "").trim();
  if (!url || url.length > 2048 || url.startsWith("data:")) return undefined;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return undefined;
  return upgradeRemoteImageUrl(url);
}

export function asContentImageUrl(raw: unknown): string | undefined {
  const original = String(raw ?? "").trim();
  if (original && isJunkRemoteImageUrl(original)) return undefined;
  const url = asHttpUrl(raw);
  if (!url || isJunkRemoteImageUrl(url)) return undefined;
  return url;
}

export function parseImageToolResultJson(raw: string): {
  type?: string;
  path?: string;
  url?: string;
  source_url?: string;
  mime?: string;
  alt?: string;
  width?: number;
  height?: number;
  status?: string;
  error?: string;
} | null {
  const text = String(raw ?? "").trim();
  if (!text || text.startsWith("ERROR:")) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (String(parsed.type ?? "").trim() !== "image") return null;
    return {
      type: "image",
      path: typeof parsed.path === "string" ? parsed.path : undefined,
      url: asContentImageUrl(parsed.url),
      source_url: asHttpUrl(parsed.source_url),
      mime: typeof parsed.mime === "string" ? parsed.mime : undefined,
      alt: typeof parsed.alt === "string" ? parsed.alt : undefined,
      width: typeof parsed.width === "number" ? parsed.width : undefined,
      height: typeof parsed.height === "number" ? parsed.height : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

export function parseImageGalleryJson(raw: string): Array<{
  type: "image";
  url: string;
  alt?: string;
  source_url?: string;
}> {
  const text = String(raw ?? "").trim();
  if (!text || text.startsWith("ERROR:")) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return [];
    if (String(parsed.type ?? "").trim() !== "image_gallery") return [];
    if (!Array.isArray(parsed.images)) return [];
    const out: Array<{ type: "image"; url: string; alt?: string; source_url?: string }> = [];
    for (const item of parsed.images) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const url = asContentImageUrl(row.url);
      if (!url) continue;
      const next: { type: "image"; url: string; alt?: string; source_url?: string } = {
        type: "image",
        url,
      };
      const alt = String(row.alt ?? "").trim();
      if (alt) next.alt = alt;
      const sourceUrl = asHttpUrl(row.source_url);
      if (sourceUrl) next.source_url = sourceUrl;
      out.push(next);
    }
    return out;
  } catch {
    return [];
  }
}

export function synthesizeImageBlocksFromTurn<
  T extends {
    id: string;
    role: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    blocks?: ContentBlock[];
  },
>(messages: T[], assistantId: string): ContentBlock[] {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return [];
  // Same rule as collectTurnPreviewImagePaths: only the last assistant in the
  // turn inherits tool images, otherwise a mid-turn line repeats the gallery.
  for (let i = idx + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") break;
    if (messages[i]?.role === "assistant") return [];
  }
  let start = 0;
  for (let i = idx; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      start = i + 1;
      break;
    }
  }
  const blocks: ContentBlock[] = [];
  for (let i = start; i < messages.length; i += 1) {
    const row = messages[i];
    if (!row || row.role === "user") break;
    if (row.role !== "tool") continue;
    const toolCallId = String(row.toolCallId ?? "").trim();
    if (row.toolName === "show_images") {
      const gallery = parseImageGalleryJson(String(row.content ?? ""));
      if (gallery.length === 0) {
        if (String(row.content ?? "").startsWith("ERROR:")) {
          blocks.push({
            type: "image",
            id: `img-${toolCallId || i}`,
            status: "error",
            error: String(row.content ?? "").replace(/^ERROR:\s*/, ""),
            kind: "remote",
            source: "tool",
          });
        }
        continue;
      }
      gallery.forEach((img, index) => {
        blocks.push({
          type: "image",
          id: `img-${toolCallId || i}-${index}`,
          status: "ready",
          url: img.url,
          alt: img.alt,
          source_url: img.source_url,
          kind: "remote",
          source: "tool",
        });
      });
      continue;
    }
    if (row.toolName !== "generate_image") continue;
    const parsed = parseImageToolResultJson(String(row.content ?? ""));
    const id = `img-${toolCallId || i}`;
    const alt = String(row.toolArgs?.prompt ?? parsed?.alt ?? "").trim();
    if (parsed?.path) {
      blocks.push({
        type: "image",
        id,
        status: "ready",
        path: parsed.path,
        mime: parsed.mime,
        alt: alt || parsed.alt,
        width: parsed.width,
        height: parsed.height,
        source: "tool",
      });
    } else if (String(row.content ?? "").startsWith("ERROR:")) {
      blocks.push({
        type: "image",
        id,
        status: "error",
        alt: alt || undefined,
        error: String(row.content ?? "").replace(/^ERROR:\s*/, ""),
        source: "tool",
      });
    }
  }
  return blocks;
}

export function resolveAssistantBlocks<
  T extends {
    id: string;
    role: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    blocks?: ContentBlock[];
  },
>(message: T, allMessages: T[]): ContentBlock[] | undefined {
  if (hasImageBlock(message.blocks)) return message.blocks;
  const synthesized = synthesizeImageBlocksFromTurn(allMessages, message.id);
  return synthesized.length > 0 ? synthesized : message.blocks;
}

export function sanitizeLoadedBlocks(raw: unknown): ContentBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = String(row.type ?? "").trim();
    if (kind === "text") {
      const text = String(row.text ?? "");
      if (text) out.push({ type: "text", text });
      continue;
    }
    if (kind !== "image") continue;
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const statusRaw = String(row.status ?? "ready").trim();
    const status =
      statusRaw === "generating" || statusRaw === "error" || statusRaw === "cancelled"
        ? statusRaw
        : "ready";
    let path = String(row.path ?? "").trim();
    if (path.startsWith("data:")) path = "";
    const block: ContentBlock = {
      type: "image",
      id,
      status,
      source: row.source === "tool" ? "tool" : undefined,
    };
    if (path) block.path = path;
    const url = asContentImageUrl(row.url);
    if (url) block.url = url;
    if (!path && !url && status === "ready") continue;
    const sourceUrl = asHttpUrl(row.source_url);
    if (sourceUrl) block.source_url = sourceUrl;
    const imageKind = String(row.kind ?? "").trim();
    if (imageKind === "remote" || imageKind === "generated") block.kind = imageKind;
    const mime = String(row.mime ?? "").trim();
    if (mime && !mime.startsWith("data:")) block.mime = mime;
    const alt = String(row.alt ?? "").trim();
    if (alt) block.alt = alt;
    const error = String(row.error ?? "").trim();
    if (error) block.error = error;
    if (typeof row.width === "number") block.width = row.width;
    if (typeof row.height === "number") block.height = row.height;
    out.push(block);
  }
  return out.length > 0 ? out : undefined;
}
