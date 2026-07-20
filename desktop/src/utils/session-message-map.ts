import type { Message, MessageAttachment, MsgRole } from "../store";
import { isMisclassifiedUploadReference } from "./composer-upload-key";
import { normalizeReferenceAttachments } from "./reference-attachment";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { isMetaLeaderIdentity } from "./display-name";
import { parseSearchReferences } from "../types/search-references";
import {
  isViewImageInjectMetadata,
  VIEW_IMAGE_INJECT_LEGACY_PREFIX,
} from "./view-image-inject";
import { parseClarificationDecisions } from "./clarification-notice";
import { parseActionConfirmationContext } from "./action-confirmation";
import {
  parseAssistantOutputForUi,
  sanitizeSuggestedQuestions,
} from "./assistant-output";

function parseSubAgentClusterAnchor(meta: Record<string, unknown> | undefined): Message["subAgentCluster"] {
  const raw = meta?.subagent_cluster;
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const clusterId = String(obj.cluster_id ?? obj.clusterId ?? "").trim();
  const rawRunIds = Array.isArray(obj.run_ids) ? obj.run_ids : Array.isArray(obj.runIds) ? obj.runIds : [];
  const runIds = rawRunIds.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!clusterId || runIds.length === 0) return undefined;
  const createdAt = Number(obj.created_at ?? obj.createdAt);
  const title = String(obj.title ?? "").trim();
  return {
    clusterId,
    runIds,
    ...(title ? { title } : {}),
    ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
  };
}

/** Snapshot row from GET /api/session/messages (snake_case). */
export function attachmentsFromSessionRow(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: MessageAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as {
      name?: unknown;
      mime_type?: unknown;
      size?: unknown;
      data_url?: unknown;
      source_path?: unknown;
      reference_token?: unknown;
      composer_ref_label?: unknown;
      line_start?: unknown;
      line_end?: unknown;
      sheet?: unknown;
      a1?: unknown;
      snippet_ref?: unknown;
      snippet_content?: unknown;
      kind?: unknown;
      html_element_ref?: unknown;
      htmlElementRef?: unknown;
    };
    const dataUrl = String(o.data_url ?? "").trim();
    const name = String(o.name ?? "").trim() || "file";
    const sizeRaw = o.size;
    const size = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : Number(sizeRaw) || 0;
    if (dataUrl.startsWith("data:image/")) {
      const mimeType = String(o.mime_type ?? "").trim() || "image/png";
      out.push({ name, mimeType, size, dataUrl });
      continue;
    }
    const kind = String(o.kind ?? "").trim();
    const sourcePath = String(o.source_path ?? "").trim();
    const composerRefLabel = String(o.composer_ref_label ?? "").trim();
    const lineStart = Number(o.line_start);
    const lineEnd = Number(o.line_end);
    const sheet = String(o.sheet ?? "").trim();
    const a1 = String(o.a1 ?? "").trim();
    const snippetRef = String(o.snippet_ref ?? "").trim();
    const snippetContent = String(o.snippet_content ?? "").trim();
    const rawHtmlEl = o.html_element_ref ?? o.htmlElementRef;
    let htmlElementRef: MessageAttachment["htmlElementRef"] | undefined;
    if (rawHtmlEl && typeof rawHtmlEl === "object") {
      const el = rawHtmlEl as Record<string, unknown>;
      const tagName = String(el.tag_name ?? el.tagName ?? "").trim();
      const selectorHint = String(el.selector_hint ?? el.selectorHint ?? tagName).trim();
      const comment = String(el.comment ?? "").trim();
      if (tagName) {
        htmlElementRef = {
          tagName,
          selectorHint: selectorHint || tagName,
          ...(comment ? { comment } : {}),
        };
      }
    }
    let referenceToken =
      Boolean(o.reference_token) ||
      !!composerRefLabel ||
      !!htmlElementRef ||
      (Number.isFinite(lineStart) && Number.isFinite(lineEnd)) ||
      !!snippetRef ||
      (!!sheet && !!a1);
    let resolvedLineRange =
      Number.isFinite(lineStart) && Number.isFinite(lineEnd)
        ? { start: Math.max(1, Math.floor(lineStart)), end: Math.max(1, Math.floor(lineEnd)) }
        : undefined;
    const draft: MessageAttachment = {
      name,
      mimeType: String(o.mime_type ?? "").trim() || "application/octet-stream",
      size,
      ...(sourcePath ? { sourcePath } : {}),
      ...(referenceToken ? { referenceToken: true } : {}),
      ...(composerRefLabel ? { composerRefLabel } : {}),
      ...(resolvedLineRange ? { lineRange: resolvedLineRange } : {}),
    };
    if (isMisclassifiedUploadReference(draft)) {
      referenceToken = false;
      resolvedLineRange = undefined;
      delete (draft as { composerRefLabel?: string }).composerRefLabel;
      draft.referenceToken = undefined;
      draft.lineRange = undefined;
    }
    if (kind === "context_file" || (!dataUrl && name)) {
      const mimeType = draft.mimeType;
      // Prefer snippetRef over bare tag so multiple same-tag HTML chips stay distinct on reload.
      const resolvedComposerLabel =
        (
          (htmlElementRef && snippetRef ? snippetRef : "") ||
          (htmlElementRef && composerRefLabel && composerRefLabel !== htmlElementRef.tagName
            ? composerRefLabel
            : "") ||
          htmlElementRef?.tagName ||
          composerRefLabel ||
          ""
        ).trim() || (referenceToken ? composerRefLabel : "");
      out.push({
        name: (htmlElementRef && snippetRef ? `${sourcePath || name}:${snippetRef}` : "") ||
          htmlElementRef?.tagName ||
          name,
        mimeType,
        size,
        ...(sourcePath ? { sourcePath } : {}),
        ...(referenceToken ? { referenceToken: true } : {}),
        ...(resolvedComposerLabel && referenceToken
          ? { composerRefLabel: resolvedComposerLabel }
          : {}),
        ...(resolvedLineRange ? { lineRange: resolvedLineRange } : {}),
        ...(sheet && a1 ? { spreadsheetRef: { sheet, a1 } } : {}),
        ...(snippetRef ? { snippetRef } : {}),
        ...(snippetContent ? { snippetContent } : {}),
        ...(htmlElementRef ? { htmlElementRef } : {}),
      });
    }
  }
  return out.length ? out : undefined;
}

function imageAttachmentsFromVisualRow(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: MessageAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as { name?: unknown; mime_type?: unknown; size?: unknown; data_url?: unknown };
    const dataUrl = String(o.data_url ?? "").trim();
    if (!dataUrl.startsWith("data:image/")) continue;
    const name = String(o.name ?? "").trim() || "image";
    const sizeRaw = o.size;
    const size = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : Number(sizeRaw) || 0;
    const mimeType = String(o.mime_type ?? "").trim() || "image/png";
    out.push({ name, mimeType, size, dataUrl });
  }
  return out.length ? out : undefined;
}

export type LoadedSessionMessage = {
  id?: string;
  role: MsgRole;
  content: string;
  agent_id?: string;
  avatar_name?: string;
  avatar_url?: string;
  provider?: string;
  model?: string;
  quoted_message_id?: string;
  quoted_content?: string;
  timestamp?: number;
  forwarded_history?: {
    title?: string;
    source_session?: string;
    note?: string;
    items?: Array<{
      sender?: string;
      role?: string;
      content?: string;
      avatar_url?: string;
      timestamp?: number;
    }>;
  };
  /** From messages.json / GET /api/session/messages */
  attachments?: unknown;
  visual_attachments?: unknown;
  metadata?: Record<string, unknown>;
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_status?: Message["toolStatus"];
  tool_elapsed_sec?: number;
  tool_result_preview?: string;
  tool_group_id?: string;
  tool_stream_lines?: string[];
  /** From `<followups>` / FINAL payload */
  suggested_questions?: string[];
  references?: Array<{
    id?: number;
    title?: string;
    url?: string;
    snippet?: string;
    source?: string;
    provider?: string;
    domain?: string;
  }>;
  searched_queries?: string[];
  /** Persisted reasoning text ( think stripped from content ). */
  reasoning?: string;
  /** Persisted reasoning duration in seconds. */
  reasoning_seconds?: number;
};

export function mapLoadedSessionMessage(
  item: LoadedSessionMessage,
  idPrefix: string,
  index: number,
  ownerSessionId?: string,
): Message {
  const forwarded = item.forwarded_history;
  const forwardedItems = Array.isArray(forwarded?.items)
    ? forwarded.items
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          sender: String(entry.sender || "").trim() || "unknown",
          role: String(entry.role || "").trim() || "assistant",
          content: String(entry.content || ""),
          avatarUrl: String(entry.avatar_url || "").trim() || undefined,
          timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
        }))
    : [];
  const storedId = item.id != null ? String(item.id).trim() : "";
  const id = `${idPrefix}-i${index}${storedId ? `-${storedId}` : ""}`;
  const agentId = item.agent_id ?? "meta";
  const rawAvatarName = item.avatar_name != null ? String(item.avatar_name).trim() : "";
  const metaLeaderRow = isMetaLeaderIdentity(agentId, rawAvatarName);
  const injectRow = isViewImageInjectMetadata(item.metadata)
    || String(item.content ?? "").trim().startsWith(VIEW_IMAGE_INJECT_LEGACY_PREFIX);
  const visualAttachments = imageAttachmentsFromVisualRow(item.visual_attachments);
  const fileAttachments = attachmentsFromSessionRow(item.attachments);
  const mergedAttachments = injectRow
    ? visualAttachments ?? fileAttachments
    : fileAttachments ?? visualAttachments;
  const rawContent = String(item.content ?? "");
  const metadata =
    item.metadata && typeof item.metadata === "object"
      ? { ...(item.metadata as Record<string, unknown>) }
      : undefined;
  const mapped: Message = {
    id,
    role: item.role,
    content: injectRow && !rawContent.trim() ? "" : rawContent,
    ownerSessionId: String(ownerSessionId ?? idPrefix ?? "").trim() || undefined,
    agentId,
    avatarName: metaLeaderRow ? META_AGENT_DISPLAY_NAME : item.avatar_name,
    avatarUrl: item.avatar_url,
    provider: item.provider,
    model: item.model,
    quotedMessageId: item.quoted_message_id,
    quotedContent: item.quoted_content,
    timestamp: typeof item.timestamp === "number" ? item.timestamp : undefined,
    forwardedHistory:
      forwarded && forwardedItems.length > 0
        ? {
            title: String(forwarded.title || "").trim() || "聊天记录",
            sourceSession: String(forwarded.source_session || "").trim(),
            note: String(forwarded.note || "").trim() || undefined,
            items: forwardedItems,
          }
        : undefined,
    attachments: normalizeReferenceAttachments(mergedAttachments),
    metadata,
    subAgentCluster: parseSubAgentClusterAnchor(metadata),
  };
  if (item.role === "assistant") {
    const parsed = parseAssistantOutputForUi(String(mapped.content ?? ""));
    mapped.content = parsed.visibleBody;
    const sq = item.suggested_questions;
    if (parsed.malformed) {
      // Detached SQ from broken protocol must not render as chips.
      delete mapped.suggestedQuestions;
    } else if (Array.isArray(sq) && sq.length > 0) {
      const cleaned = sanitizeSuggestedQuestions(sq, parsed.visibleBody);
      if (cleaned.length > 0) mapped.suggestedQuestions = cleaned;
    }
    const refs = parseSearchReferences(item.references);
    if (refs.length > 0) mapped.references = refs;
    const queries = item.searched_queries;
    if (Array.isArray(queries) && queries.length > 0) {
      mapped.searchedQueries = queries.map((x) => String(x).trim()).filter(Boolean);
    }
    const reasoning = item.reasoning;
    if (typeof reasoning === "string" && reasoning.trim()) {
      mapped.reasoning = reasoning.trim();
    } else if (!parsed.malformed && parsed.reasoning.trim()) {
      mapped.reasoning = parsed.reasoning.trim();
    }
    if (parsed.malformed) {
      delete mapped.reasoning;
    }
    if (typeof item.reasoning_seconds === "number" && item.reasoning_seconds >= 1) {
      mapped.reasoningSeconds = Math.round(item.reasoning_seconds);
    }
  }
  if (item.role === "tool") {
    const toolCallId = String(item.tool_call_id ?? "").trim();
    const toolName = String(item.tool_name ?? "").trim();
    const toolGroupId = String(item.tool_group_id ?? "").trim();
    const toolResultPreview = String(item.tool_result_preview ?? "").trim();
    if (toolCallId) mapped.toolCallId = toolCallId;
    if (toolName) mapped.toolName = toolName;
    if (item.tool_args && typeof item.tool_args === "object") mapped.toolArgs = item.tool_args;
    if (item.tool_status) mapped.toolStatus = item.tool_status;
    if (typeof item.tool_elapsed_sec === "number") mapped.toolElapsedSec = item.tool_elapsed_sec;
    if (toolResultPreview) mapped.toolResultPreview = toolResultPreview;
    if (toolGroupId) mapped.toolGroupId = toolGroupId;
    if (Array.isArray(item.tool_stream_lines)) mapped.toolStreamLines = item.tool_stream_lines;
    // Reconstruct the inline clarification card from persisted metadata so the
    // prompt stays visible after session switch / refresh (NFR-2).
    const meta = mapped.metadata;
    if (meta && typeof meta === "object" && (meta as Record<string, unknown>).kind === "clarification") {
      const m = meta as Record<string, unknown>;
      const requestId = String(m.request_id ?? m.id ?? "").trim();
      if (requestId) {
        const rawContext =
          m.context && typeof m.context === "object"
            ? (m.context as Record<string, unknown>)
            : undefined;
        const sessionId = String(ownerSessionId ?? idPrefix ?? "").trim();
        // Action confirmation reuses clarification persistence with context.kind.
        if (rawContext && String(rawContext.kind ?? "").trim() === "action_confirmation") {
          const answered = m.clarification_answered === true;
          const answerPayload =
            m.clarification_answer && typeof m.clarification_answer === "object"
              ? (m.clarification_answer as Record<string, unknown>)
              : null;
          const selected = Array.isArray(answerPayload?.selected_options)
            ? (answerPayload!.selected_options as unknown[]).map((o) => String(o)).filter(Boolean)
            : [];
          const approveLabel = String(rawContext.approve_label ?? rawContext.approveLabel ?? "确认执行").trim() || "确认执行";
          const rejectLabel = String(rawContext.reject_label ?? rawContext.rejectLabel ?? "取消").trim() || "取消";
          let status: NonNullable<Message["actionConfirmation"]>["status"] = "pending";
          if (answered) {
            if (selected.includes(approveLabel) || selected.some((s) => ["确认", "确认发送", "同意", "继续", "yes", "y", "ok"].includes(s.toLowerCase()))) {
              status = "approved";
            } else {
              status = "rejected";
            }
          }
          const parsed = parseActionConfirmationContext({
            requestId,
            sessionId,
            agentId,
            context: rawContext,
            status,
          });
          if (parsed) {
            const expired =
              parsed.status === "pending" &&
              typeof parsed.expiresAtMs === "number" &&
              parsed.expiresAtMs > 0 &&
              parsed.expiresAtMs <= Date.now();
            mapped.actionConfirmation = expired ? { ...parsed, status: "expired" } : parsed;
            mapped.toolName = mapped.toolName || "request_action_confirmation";
            // Do not also attach ClarificationCard for the same row.
          }
        } else {
          const rawOptions = Array.isArray(m.options) ? m.options : [];
          const decisions = parseClarificationDecisions(m.decisions);
          mapped.clarificationPrompt = {
            requestId,
            prompt: String(m.prompt ?? item.content ?? ""),
            options: rawOptions.map((o) => String(o)).filter(Boolean),
            decisions: decisions.length > 0 ? decisions : undefined,
            allowFreeText: m.allow_free_text !== false,
            agentId,
            sessionId,
            context: rawContext,
          };
          if (m.suspended === true) mapped.clarificationSuspended = true;
        }
      }
    }
    // Restore compaction noticeKind from persisted metadata so ContextNoticeLine
    // survives session switch / reload without relying on Chinese text matching.
    if (meta && typeof meta === "object") {
      const kind = String((meta as Record<string, unknown>).kind ?? "").trim();
      if (kind === "compaction_proactive" || kind === "compaction_reactive") {
        mapped.noticeKind = kind;
      }
    }
  }
  return mapped;
}
