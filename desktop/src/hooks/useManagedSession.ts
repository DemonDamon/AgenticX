import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  applyMaEvents,
  applyMaPreview,
  createMaTranscript,
  markMaApprovalResolved,
  pendingMaApprovals,
  reconcilePendingUserRows,
  type MaAdapterOptions,
  type MaTranscript,
} from "../utils/ma-event-adapter";
import type { MaPreviewFrame, MaWireEvent } from "../utils/ma-types";
import type { Message } from "../store";
import { useAppStore } from "../store";

export type ManagedSessionView = {
  ready: boolean;
  error: { code: string; message: string } | null;
  connection: "connecting" | "open" | "reconnecting" | "closed" | "error";
  transcript: MaTranscript;
  messages: Message[];
  sendMessage(text: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  interrupt(): Promise<void>;
  resolveApproval(toolUseId: string, allow: boolean): Promise<{ ok: boolean; code?: string }>;
  /** Re-runs history load and the live stream. Wired to the transcript retry button. */
  retry(): void;
};

const ALREADY_RESOLVED = new Set(["resolution_conflict", "resolution_not_found", "duplicate_resolution"]);

type QueuedFrame =
  | { kind: "event"; event: MaWireEvent }
  | { kind: "preview"; frame: MaPreviewFrame };

export function useManagedSession(
  sessionId: string | null,
  opts: { assistantName: string },
): ManagedSessionView {
  const { t } = useTranslation("chat");
  const setManagedApprovals = useAppStore((s) => s.setManagedApprovals);
  const removeManagedApproval = useAppStore((s) => s.removeManagedApproval);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [connection, setConnection] = useState<ManagedSessionView["connection"]>(sessionId ? "connecting" : "closed");
  const [transcript, setTranscript] = useState(() => createMaTranscript(sessionId ?? ""));
  const [pending, setPending] = useState<Message[]>([]);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const labelsRef = useRef<MaAdapterOptions["labels"]>(buildLabels(t));
  labelsRef.current = buildLabels(t);
  const nameRef = useRef(opts.assistantName);
  nameRef.current = opts.assistantName;
  const selfResolved = useRef(new Set<string>());
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!sessionId) {
      setReady(false);
      setError(null);
      setConnection("closed");
      setTranscript(createMaTranscript(""));
      setPending([]);
      return;
    }
    const sid = sessionId;
    let cancelled = false;
    let streamId = "";
    let offFrame: (() => void) | undefined;
    let offState: (() => void) | undefined;
    let raf = 0;
    const queue: QueuedFrame[] = [];

    const flush = () => {
      raf = 0;
      if (cancelled) {
        queue.length = 0;
        return;
      }
      const batch = queue.splice(0, queue.length);
      if (batch.length === 0) return;
      const adapterOpts = { assistantName: nameRef.current, labels: labelsRef.current };
      setTranscript((current) => {
        let next = current;
        for (const entry of batch) {
          next = entry.kind === "preview"
            ? applyMaPreview(next, entry.frame)
            : applyMaEvents(next, [entry.event], adapterOpts);
        }
        return next;
      });
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };

    void (async () => {
      setReady(false);
      setError(null);
      setConnection("connecting");
      setPending([]);
      let next = createMaTranscript(sid);
      setTranscript(next);
      const api = window.agenticxDesktop;
      if (!api?.maListEvents || !api.maStreamOpen || !api.maStreamClose || !api.onMaStreamFrame || !api.onMaStreamState) {
        if (cancelled) return;
        setError({ code: "desktop_api_missing", message: "无法连接企业服务" });
        setConnection("error");
        return;
      }
      let cursor = 0;
      try {
        for (;;) {
          const page = await api.maListEvents(sid, cursor, 500);
          if (cancelled) return;
          if (!page.ok) {
            setError({
              code: page.code,
              message: page.code === "enterprise_login_required" ? "请先登录企业账号" : page.message,
            });
            setConnection("error");
            return;
          }
          const rows = Array.isArray(page.data?.data) ? page.data.data : [];
          next = applyMaEvents(next, rows.flatMap((item) => {
            const event = asWire(item);
            return event ? [event] : [];
          }), {
            assistantName: nameRef.current,
            labels: labelsRef.current,
          });
          setTranscript(next);
          if (!page.data?.has_more) break;
          const nextCursor = page.data.next_after_seq;
          if (typeof nextCursor !== "number" || nextCursor <= cursor) break;
          cursor = nextCursor;
        }
      } catch {
        if (cancelled) return;
        setError({ code: "network_error", message: "无法连接企业服务" });
        setConnection("error");
        return;
      }
      if (cancelled) return;
      setReady(true);
      streamId = `ma-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      offFrame = api.onMaStreamFrame((payload) => {
        if (payload.streamId !== streamId) return;
        if (payload.event === "event_start" || payload.event === "event_delta") {
          const frame = asPreview(payload.data, payload.event);
          if (!frame) return;
          queue.push({ kind: "preview", frame });
          schedule();
          return;
        }
        const event = asWire(payload.data);
        if (!event) return;
        queue.push({ kind: "event", event });
        schedule();
      });
      offState = api.onMaStreamState((payload) => {
        if (payload.streamId !== streamId) return;
        setConnection(mapConnection(payload.state));
        if (payload.state === "error") {
          setError({
            code: payload.code || "stream_error",
            message: payload.code === "enterprise_login_required"
              ? "请先登录企业账号"
              : (payload.message || payload.code || "连接中断"),
          });
        }
      });
      const opened = await api.maStreamOpen(streamId, sid, next.lastSeq);
      if (cancelled) {
        void api.maStreamClose(streamId);
        return;
      }
      if (!opened.ok) {
        setError({
          code: opened.code,
          message: opened.code === "enterprise_login_required" ? "请先登录企业账号" : opened.code,
        });
        setConnection("error");
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      offFrame?.();
      offState?.();
      if (streamId) void window.agenticxDesktop?.maStreamClose(streamId);
      setManagedApprovals(sid, []);
    };
  }, [sessionId, attempt, setManagedApprovals]);

  useEffect(() => {
    if (!sessionId || transcript.sessionId !== sessionId) return;
    const items = pendingMaApprovals(transcript).map((item) => ({
      ...item,
      agentName: opts.assistantName,
    }));
    setManagedApprovals(sessionId, items);
  }, [sessionId, transcript, opts.assistantName, setManagedApprovals]);

  useEffect(() => {
    if (!sessionId) return;
    const sid = sessionId;
    return useAppStore.subscribe((state, prev) => {
      const before = prev.managedApprovals[sid] ?? [];
      const after = state.managedApprovals[sid] ?? [];
      const removed = before.filter((item) => !after.some((row) => row.toolUseId === item.toolUseId));
      if (removed.length === 0) return;
      setTranscript((current) => {
        let next = current;
        for (const item of removed) {
          if (selfResolved.current.has(item.toolUseId) || next.resolved[item.toolUseId]) continue;
          next = markMaApprovalResolved(next, item.toolUseId, "allow");
        }
        return next;
      });
    });
  }, [sessionId]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false as const, code: "empty", message: "" };
    if (!sessionId) return { ok: false as const, code: "no_session", message: "" };
    const row: Message = {
      id: `ma-pending-${crypto.randomUUID()}`,
      role: "user",
      content: trimmed,
      ownerSessionId: sessionId,
      timestamp: Date.now(),
    };
    setPending((prev) => [...prev, row]);
    try {
      const res = await window.agenticxDesktop.maPostEvents(sessionId, [{
        type: "user.message",
        content: [{ type: "text", text: trimmed }],
      }]);
      if (res.ok) return { ok: true as const };
      setPending((prev) => prev.filter((item) => item.id !== row.id));
      const message = res.code === "session_requires_action"
        ? tRef.current("managed.requiresActionBlocked")
        : res.message;
      return { ok: false as const, code: res.code, message };
    } catch {
      setPending((prev) => prev.filter((item) => item.id !== row.id));
      return { ok: false as const, code: "network_error", message: "无法连接企业服务" };
    }
  }, [sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await window.agenticxDesktop.maPostEvents(sessionId, [{ type: "user.interrupt" }]);
      if (!res.ok) console.warn("[ma] interrupt failed", res.code);
    } catch {
      console.warn("[ma] interrupt failed", "network_error");
    }
  }, [sessionId]);

  const resolveApproval = useCallback(async (toolUseId: string, allow: boolean) => {
    if (!sessionId) return { ok: false, code: "no_session" };
    const current = transcriptRef.current;
    const result = allow ? "allow" : "deny";
    selfResolved.current.add(toolUseId);
    setTranscript(markMaApprovalResolved(current, toolUseId, result));
    removeManagedApproval(sessionId, toolUseId);
    const restore = () => {
      selfResolved.current.delete(toolUseId);
      setTranscript(current);
      setManagedApprovals(sessionId, pendingMaApprovals(current).map((item) => ({
        ...item,
        agentName: nameRef.current,
      })));
    };
    try {
      const res = await window.agenticxDesktop.maPostEvents(sessionId, [{
        type: "user.tool_confirmation",
        tool_use_id: toolUseId,
        result,
      }]);
      if (res.ok) return { ok: true };
      if (ALREADY_RESOLVED.has(res.code)) return { ok: true };
      restore();
      return { ok: false, code: res.code };
    } catch {
      restore();
      return { ok: false, code: "network_error" };
    }
  }, [removeManagedApproval, sessionId, setManagedApprovals]);

  const messages = useMemo(() => {
    if (!sessionId || transcript.sessionId !== sessionId) return [];
    return [...transcript.rows, ...reconcilePendingUserRows(pending, transcript.rows)];
  }, [pending, sessionId, transcript]);

  const aligned = Boolean(sessionId) && transcript.sessionId === sessionId;

  return {
    ready: aligned && ready,
    error: aligned ? error : null,
    connection: sessionId ? connection : "closed",
    transcript: aligned ? transcript : createMaTranscript(sessionId ?? ""),
    messages,
    sendMessage,
    interrupt,
    resolveApproval,
    retry: () => setAttempt((value) => value + 1),
  };
}

function buildLabels(t: TFunction<"chat">): MaAdapterOptions["labels"] {
  return {
    retries: t("managed.stop.retries"),
    refusal: t("managed.stop.refusal"),
    policy: t("managed.stop.policy"),
    terminated: t("managed.terminated"),
    customToolPending: t("managed.customToolPending"),
    rounds: t("managed.stop.rounds"),
    budget: t("managed.stop.budget"),
    confirmQuestion: (tool: string) => t("managed.confirmQuestion", { tool }),
  };
}

function mapConnection(state: string): ManagedSessionView["connection"] {
  switch (state) {
    case "open":
    case "reconnecting":
    case "closed":
    case "error":
    case "connecting":
      return state;
    default:
      return "error";
  }
}

function asWire(data: unknown): MaWireEvent | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.seq !== "number" || typeof row.type !== "string") return null;
  const id = typeof row.id === "string" && row.id ? row.id : String(row.seq);
  return { ...row, id, seq: row.seq, type: row.type };
}

function asPreview(data: unknown, eventName: string): MaPreviewFrame | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : eventName;
  if (type === "event_start" && row.event && typeof row.event === "object") {
    const event = row.event as Record<string, unknown>;
    return { type: "event_start", event: { ...event, type: typeof event.type === "string" ? event.type : "" } };
  }
  if (type === "event_delta") {
    const eventType = row.event_type === "agent.thinking" ? "agent.thinking" : row.event_type === "agent.message" ? "agent.message" : null;
    if (!eventType || typeof row.content_delta !== "string") return null;
    return { type: "event_delta", event_type: eventType, content_delta: row.content_delta };
  }
  return null;
}
