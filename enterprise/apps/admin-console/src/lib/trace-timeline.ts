import type { TraceNode, TraceTimeline } from "@agenticx/core-api";
import type { PortalLogItem } from "./portal-logs-query";
import type { AgentTraceSpanRow } from "./agent-trace-store";
import type { DeepResearchRunByTrace } from "./deep-research-trace-query";

const NARRATIVE_MAX = 200;

export type TraceTimelineInput = {
  traceId: string;
  portalLogs: PortalLogItem[];
  modelSpans: AgentTraceSpanRow[];
  deepResearchRun: DeepResearchRunByTrace | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventType(event: unknown): string {
  return isRecord(event) && typeof event.type === "string" ? event.type : "unknown";
}

function truncateNarrative(text: string): string {
  if (text.length <= NARRATIVE_MAX) return text;
  return `${text.slice(0, NARRATIVE_MAX)}…`;
}

function sanitizeDrEventAttrs(event: Record<string, unknown>): Record<string, unknown> {
  const type = typeof event.type === "string" ? event.type : "unknown";
  if (type === "narrative") {
    const text = typeof event.text === "string" ? event.text : "";
    return { type, text: truncateNarrative(text) };
  }
  if (type === "research_plan") {
    const plan = isRecord(event.plan) ? event.plan : null;
    const subQuestions = Array.isArray(plan?.subQuestions)
      ? plan.subQuestions.map((q) => {
          if (!isRecord(q)) return { title: String(q) };
          return {
            id: typeof q.id === "string" ? q.id : undefined,
            title: typeof q.title === "string" ? q.title : undefined,
          };
        })
      : undefined;
    return {
      type,
      action: event.action,
      version: event.version,
      plan: plan
        ? {
            version: plan.version,
            objective: typeof plan.objective === "string" ? plan.objective : undefined,
            subQuestions,
          }
        : undefined,
    };
  }
  if (type === "lane_sources") {
    const sources = Array.isArray(event.sources)
      ? event.sources.map((src) => {
          if (!isRecord(src)) return src;
          return {
            title: typeof src.title === "string" ? src.title : undefined,
            url: typeof src.url === "string" ? src.url : undefined,
          };
        })
      : [];
    return { type, laneId: event.laneId, sources };
  }
  // Drop heavy / sensitive fields; keep structural identifiers.
  const {
    prompt: _prompt,
    promptText: _promptText,
    messages: _messages,
    content: _content,
    ...rest
  } = event;
  return rest;
}

function labelForDrEvent(event: Record<string, unknown>): string {
  const type = typeof event.type === "string" ? event.type : "event";
  if (type === "phase" && typeof event.phase === "string") {
    return `phase: ${event.phase}`;
  }
  if (type === "lane_started") {
    const title = typeof event.title === "string" ? event.title : "";
    return title ? `lane: ${title}` : "lane_started";
  }
  if (type === "artifact") {
    const title = typeof event.title === "string" ? event.title : "";
    return title ? `artifact: ${title}` : "artifact";
  }
  if (type === "research_stats") {
    return "research_stats";
  }
  if (type === "narrative") {
    return "narrative";
  }
  return type;
}

function buildDeepResearchChildren(events: unknown[]): TraceNode[] {
  const roots: TraceNode[] = [];
  let currentPhase: TraceNode | null = null;
  const laneNodes = new Map<string, TraceNode>();

  const attach = (node: TraceNode) => {
    if (currentPhase) {
      currentPhase.children.push(node);
      return;
    }
    roots.push(node);
  };

  for (let i = 0; i < events.length; i += 1) {
    const raw = events[i];
    if (!isRecord(raw)) continue;
    const type = eventType(raw);

    if (type === "phase") {
      const phase = typeof raw.phase === "string" ? raw.phase : "unknown";
      currentPhase = {
        id: `dr-phase-${i}-${phase}`,
        kind: "dr_phase",
        label: `phase: ${phase}`,
        status: phase,
        attrs: sanitizeDrEventAttrs(raw),
        children: [],
      };
      laneNodes.clear();
      roots.push(currentPhase);
      continue;
    }

    if (type === "lane_started") {
      const laneId = typeof raw.laneId === "string" ? raw.laneId : `lane-${i}`;
      const laneNode: TraceNode = {
        id: `dr-lane-${laneId}-${i}`,
        kind: "dr_lane",
        label: labelForDrEvent(raw),
        attrs: sanitizeDrEventAttrs(raw),
        children: [],
      };
      laneNodes.set(laneId, laneNode);
      attach(laneNode);
      continue;
    }

    if (type === "lane_progress" || type === "lane_sources" || type === "lane_done") {
      const laneId = typeof raw.laneId === "string" ? raw.laneId : "";
      const parent = laneId ? laneNodes.get(laneId) : undefined;
      const child: TraceNode = {
        id: `dr-event-${type}-${i}`,
        kind: "dr_event",
        label: labelForDrEvent(raw),
        status: type === "lane_done" && typeof raw.status === "string" ? raw.status : undefined,
        attrs: sanitizeDrEventAttrs(raw),
        children: [],
      };
      if (parent) {
        parent.children.push(child);
      } else {
        attach(child);
      }
      continue;
    }

    attach({
      id: `dr-event-${type}-${i}`,
      kind: "dr_event",
      label: labelForDrEvent(raw),
      attrs: sanitizeDrEventAttrs(raw),
      children: [],
    });
  }

  return roots;
}

/**
 * Pure assembler: stitches portal logs + model spans + deep-research events into a tree.
 * Deterministic rules — see plan FR-6.
 */
export function assembleTraceTimeline(input: TraceTimelineInput): TraceTimeline {
  const logs = [...input.portalLogs].sort((a, b) => a.log_time.localeCompare(b.log_time));
  const spans = [...input.modelSpans].sort((a, b) => a.step_no - b.step_no);

  const requestNodes: TraceNode[] = logs.map((log) => ({
    id: `req-${log.id}`,
    kind: "request",
    label: log.event || log.route || "request",
    status: log.status != null ? String(log.status) : log.level,
    startedAt: log.log_time,
    durationMs: log.duration_ms ?? undefined,
    attrs: {
      route: log.route,
      level: log.level,
      user_id: log.user_id,
      session_id: log.session_id,
      error_message: log.error_message,
    },
    children: [],
  }));

  const primary =
    requestNodes.find((n) => n.label.includes("chat.completions.finish")) ??
    requestNodes.find((n) => n.label.includes("chat.completions")) ??
    requestNodes[0] ??
    null;

  const modelChildren: TraceNode[] = spans.map((span) => {
    const stage =
      isRecord(span.metadata) && typeof span.metadata.stage === "string"
        ? span.metadata.stage.trim()
        : "";
    const modelPart = `${span.provider ?? "?"}/${span.model ?? "?"}`;
    const label = stage
      ? `step ${span.step_no} · ${stage} · ${modelPart}`
      : `step ${span.step_no} · ${modelPart}`;
    return {
      id: `model-${span.id}`,
      kind: "model_step" as const,
      label,
      status: span.status,
      durationMs: span.duration_ms,
      tokens: {
        input: span.input_tokens,
        output: span.output_tokens,
        reasoning: span.reasoning_tokens,
        total: span.total_tokens,
      },
      costUsd: Number(span.cost_usd) || 0,
      attrs: {
        provider: span.provider,
        model: span.model,
        step_kind: span.step_kind,
        stage: stage || undefined,
        error_message: span.error_message,
        metadata: span.metadata,
        ...(isRecord(span.metadata) && span.metadata.io ? { io: span.metadata.io } : {}),
      },
      children: [],
    };
  });

  if (primary) {
    primary.children.push(...modelChildren);
  } else if (modelChildren.length > 0) {
    // No portal log row — still surface model steps as top-level.
    requestNodes.push(...modelChildren);
  }

  if (input.deepResearchRun) {
    const drChildren = buildDeepResearchChildren(input.deepResearchRun.events);
    const host = primary ?? requestNodes[0];
    if (host) {
      host.children.push(...drChildren);
    } else {
      requestNodes.push(...drChildren);
    }
  }

  const totalTokens = spans.reduce((sum, s) => sum + (s.total_tokens || 0), 0);
  const totalCost = spans.reduce((sum, s) => sum + (Number(s.cost_usd) || 0), 0);
  const primaryDuration =
    primary?.durationMs ??
    (logs.find((l) => l.route === "chat.completions" || l.event.includes("chat.completions"))
      ?.duration_ms ??
      null);

  return {
    trace_id: input.traceId,
    nodes: requestNodes,
    totals: {
      steps: spans.length,
      tokens: totalTokens,
      cost_usd: totalCost,
      duration_ms: primaryDuration,
    },
    sources: {
      portal_logs: logs.length,
      model_steps: spans.length,
      deep_research_run: Boolean(input.deepResearchRun),
    },
  };
}
