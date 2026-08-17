import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import type { ResearchStep } from "./deep-research-steps";
import type { LaneSource } from "./deep-research-lane-sources";

export type DeepResearchSegment =
  | { kind: "narrative"; id: string; text: string }
  | { kind: "clarify"; id: string }
  | { kind: "clarify_chat"; id: string; roundIndex: number }
  | { kind: "plan"; id: string }
  | { kind: "plan_chat"; id: string }
  | {
      kind: "tools";
      id: string;
      title: string;
      steps: ResearchStep[];
    }
  | {
      kind: "status";
      id: string;
      title: string;
      status: "running" | "done" | "failed";
      detailLines: string[];
    }
  | {
      kind: "reflection";
      id: string;
      gaps: string[];
    }
  | {
      kind: "stats";
      id: string;
      label: string;
    };

export type DeepResearchArtifactEvent = Extract<DeepResearchEvent, { type: "artifact" }>;

type LaneDraft = {
  laneId: string;
  title: string;
  index: number;
  total: number;
  status: "running" | "done" | "failed";
  artifactPath?: string;
  artifactId?: string;
  detailLines: string[];
  /** Web pages searched by this lane. */
  sourceList?: LaneSource[];
};

function laneToStep(lane: LaneDraft): ResearchStep {
  return {
    id: `lane-${lane.laneId}`,
    kind: "lane",
    title: "搜索网页",
    // The always-visible metric chips carry the counts; a "· N 个结果" suffix
    // would only compete with them for the truncated subtitle line.
    subtitle: lane.title,
    status: lane.status,
    detailLines: lane.detailLines,
    artifactPath: lane.artifactPath,
    artifactId: lane.artifactId,
    sources: lane.sourceList,
  };
}

/** Rewrite in-progress tools title once all lanes have settled (or run completed). */
export function finalizeToolsCardTitle(
  title: string,
  stepCount: number,
  settled: boolean,
): string {
  const raw = title.trim() || "正在并行检索…";
  if (!settled) return raw;

  let next = raw
    .replace(/[，,]?\s*正在并行检索…?\s*$/u, "")
    .replace(/正在并行检索…?/gu, "")
    .trim();

  if (!next) {
    return `已完成 ${stepCount} 条调研车道检索`;
  }
  if (/已拆解/.test(next)) {
    next = next.replace(/已拆解/, "已完成");
    if (!/检索/.test(next)) next = `${next}检索`;
    return next;
  }
  if (next.startsWith("正在")) {
    return `已${next.replace(/^正在/u, "").replace(/…+$/u, "")}`;
  }
  if (!/完成|已完成|结束/.test(next)) {
    return `${next} · 已完成`;
  }
  return next;
}

/**
 * Past-tense title for a finished phase row, so a completed step never keeps
 * reading "正在撰写…" next to a check mark.
 */
export function completedPhaseTitle(title: string): string {
  const raw = title.trim().replace(/…+$/u, "");
  if (!raw) return title.trim();
  if (raw === "正在综合分析") return "已完成综合分析";
  if (raw.startsWith("正在")) return `已${raw.replace(/^正在/u, "")}`;
  return raw;
}

function processPhaseDetail(phase: "clarify" | "plan" | "reflect"): string {
  switch (phase) {
    case "clarify":
      return "正在判断现有信息是否足以开始研究。";
    case "plan":
      return "正在把问题拆解为可验证的研究路径。";
    case "reflect":
      return "正在交叉核对来源，并在预算内补充关键证据。";
  }
}

function modelProgressDetail(kind: "reasoning" | "draft", text: string): string {
  const label = kind === "reasoning" ? "思考过程" : "生成中的内容";
  return `${label}\n${text}`;
}

/**
 * Final / non-memo artifacts for the delivery strip after the report body.
 * Lane memos stay attached to expandable search steps only.
 */
export function collectDeepResearchDeliveryArtifacts(
  events: DeepResearchEvent[],
): DeepResearchArtifactEvent[] {
  const out: DeepResearchArtifactEvent[] = [];
  for (const event of events) {
    if (event.type !== "artifact") continue;
    if (event.kind === "memo") continue;
    out.push(event);
  }
  return out;
}

/**
 * Chronological segments for interleaved rendering:
 * narrative → clarify → narrative → tools card → narrative → status …
 * Planning phases fold into the tools card title (no giant checklist dump).
 * Report artifacts are deferred to {@link collectDeepResearchDeliveryArtifacts}.
 */
export function buildDeepResearchSegments(
  events: DeepResearchEvent[],
  status?: ChatMessageDeepResearch["status"],
): DeepResearchSegment[] {
  const segments: DeepResearchSegment[] = [];
  let clarifyPushed = false;
  const clarifyChatRounds = new Set<number>();
  let planPushed = false;
  let planVisibility: "hidden" | "preview" | "editable" | "chat_editable" = "hidden";
  let toolsTitle = "正在并行检索…";
  let toolsId = "tools-1";
  let lanes = new Map<string, LaneDraft>();
  let seq = 0;
  // Writing phases are one task list, not one card per phase message.
  let writeSteps: ResearchStep[] = [];
  let writeId = "synthesize-1";
  let wroteCard = false;
  let processStatus: Extract<DeepResearchSegment, { kind: "status" }> | null = null;
  const processRowsByPhase = new Map<
    "clarify" | "plan" | "reflect",
    Extract<DeepResearchSegment, { kind: "status" }>
  >();
  const runTerminal =
    status === "completed" || status === "failed" || status === "cancelled";

  /** Model preparation/refinement stays readable without exposing raw chain-of-thought. */
  const settleProcessStatus = (outcome: "done" | "failed") => {
    if (!processStatus || processStatus.status !== "running") return;
    processStatus.status = outcome;
    if (outcome === "done") {
      processStatus.title = completedPhaseTitle(processStatus.title);
    }
    processStatus = null;
  };

  /** A writing step is finished the moment the next one starts. */
  const settleWriteSteps = (outcome: "done" | "failed") => {
    for (const step of writeSteps) {
      if (step.status !== "running") continue;
      if (outcome === "failed") {
        step.status = "failed";
        continue;
      }
      step.status = "done";
      step.title = completedPhaseTitle(step.title);
    }
  };

  const flushWrite = () => {
    if (writeSteps.length === 0) return;
    // A settled run can have no live step, even if no `done` phase arrived.
    if (runTerminal) settleWriteSteps(status === "completed" ? "done" : "failed");
    const running = writeSteps.some((s) => s.status === "running");
    segments.push({
      kind: "tools",
      id: writeId,
      title: running ? "正在撰写报告…" : `已完成报告撰写 · ${writeSteps.length} 步`,
      steps: writeSteps,
    });
    wroteCard = true;
    writeSteps = [];
    writeId = `synthesize-${++seq}`;
  };

  const flushTools = () => {
    if (lanes.size === 0) return;
    // A settled run can leave lanes with only `lane_started` (no `lane_done`)
    // when the process died mid-search. Without this, the UI keeps a fake
    // "搜索网页" spinner forever on a failed/cancelled run.
    if (runTerminal) {
      for (const lane of lanes.values()) {
        if (lane.status === "running") {
          lane.status = status === "completed" ? "done" : "failed";
        }
      }
    }
    const steps = [...lanes.values()]
      .sort((a, b) => a.index - b.index)
      .map(laneToStep);
    const allSettled = steps.every((s) => s.status === "done" || s.status === "failed");
    segments.push({
      kind: "tools",
      id: toolsId,
      title: finalizeToolsCardTitle(toolsTitle, steps.length, allSettled || runTerminal),
      steps,
    });
    lanes = new Map();
    toolsId = `tools-${++seq}`;
  };

  /** Lanes precede writing steps chronologically, so flush in that order. */
  const flushCards = () => {
    flushTools();
    flushWrite();
  };

  for (const event of events) {
    switch (event.type) {
      case "run_started":
        break;
      case "narrative": {
        const text = event.text.trim();
        // 计划对齐多轮内部旁白由 PlanChatCard 自己渲染，避免气泡重复刷屏。
        if (
          /^你：/.test(text) ||
          /正在根据你的反馈更新计划/.test(text) ||
          /^已更新计划 v\d+/.test(text)
        ) {
          break;
        }
        settleProcessStatus("done");
        flushCards();
        if (text) {
          segments.push({ kind: "narrative", id: `narrative-${seq++}`, text });
        }
        break;
      }
      case "clarify": {
        if (!clarifyPushed) {
          settleProcessStatus("done");
          flushCards();
          segments.push({ kind: "clarify", id: "clarify" });
          clarifyPushed = true;
        }
        break;
      }
      case "clarify_chat": {
        // 计划对齐引导折入 plan_chat 卡，不单独成段。
        if (event.phase === "plan") break;
        // 每轮对话澄清独立成段（roundIndex 去重，防事件重放重复渲染）。
        const round = typeof event.roundIndex === "number" ? event.roundIndex : 0;
        if (!clarifyChatRounds.has(round)) {
          settleProcessStatus("done");
          flushCards();
          clarifyChatRounds.add(round);
          segments.push({ kind: "clarify_chat", id: `clarify-chat-${round}`, roundIndex: round });
        }
        break;
      }
      case "research_profile": {
        planVisibility = event.planVisibility;
        break;
      }
      case "research_plan": {
        // hidden 计划不渲染；可见计划只渲染一张卡（最新版本由卡片自取）。
        if (planVisibility !== "hidden" && !planPushed) {
          settleProcessStatus("done");
          flushCards();
          if (planVisibility === "chat_editable") {
            segments.push({ kind: "plan_chat", id: "plan-chat" });
          } else {
            segments.push({ kind: "plan", id: "plan" });
          }
          planPushed = true;
        }
        break;
      }
      case "clarify_timeout":
        break;
      case "phase": {
        // Recon immediately emits a visible search lane, so another process row
        // would duplicate the same activity.
        if (event.phase === "recon") break;
        if (
          event.phase === "clarify" ||
          event.phase === "plan" ||
          event.phase === "reflect"
        ) {
          settleProcessStatus("done");
          flushCards();
          const fallbackTitle =
            event.phase === "clarify"
              ? "正在判断是否需要澄清…"
              : event.phase === "plan"
                ? "正在规划研究路径…"
                : "正在复核并补充关键证据…";
          const title = event.message?.trim() || fallbackTitle;
          const processOutcome =
            status === "completed" ? "done" : runTerminal ? "failed" : "running";
          const row: Extract<DeepResearchSegment, { kind: "status" }> = {
            kind: "status",
            id: `phase-${event.phase}-${seq++}`,
            title: processOutcome === "done" ? completedPhaseTitle(title) : title,
            status: processOutcome,
            detailLines: [processPhaseDetail(event.phase)],
          };
          segments.push(row);
          processRowsByPhase.set(event.phase, row);
          processStatus = processOutcome === "running" ? row : null;
          break;
        }
        if (event.phase === "lanes") {
          settleProcessStatus("done");
          flushCards();
          toolsTitle = event.message || "正在并行检索…";
          break;
        }
        if (event.phase === "synthesize") {
          settleProcessStatus("done");
          flushTools();
          settleWriteSteps("done");
          writeSteps.push({
            id: `synthesize-step-${seq++}`,
            kind: "phase",
            title: event.message?.trim() || "综合分析",
            status: "running",
            detailLines: [],
          });
          break;
        }
        if (event.phase === "done") {
          settleProcessStatus(
            status === "failed" || status === "cancelled" ? "failed" : "done",
          );
          flushTools();
          settleWriteSteps(status === "failed" || status === "cancelled" ? "failed" : "done");
          flushWrite();
          // The writing card already says "已完成报告撰写" — a second "深度研究完成"
          // pill just repeats the same signal. Keep failed / cancelled / partial rows.
          const message = event.message?.trim() || "";
          const plainSuccess =
            status === "completed" &&
            (message === "" || message === "深度研究完成");
          if (!(wroteCard && plainSuccess)) {
            segments.push({
              kind: "status",
              id: `phase-done-${seq++}`,
              title: message || event.phase,
              status: status === "failed" ? "failed" : "done",
              detailLines: message ? [message] : [],
            });
          }
        }
        break;
      }
      case "reasoning": {
        const detail = modelProgressDetail(event.kind, event.text);
        if (event.phase === "synthesize") {
          const step = [...writeSteps].reverse().find((candidate) => candidate.status === "running");
          if (!step) break;
          step.detailLines = [detail];
          if (event.done) {
            step.status = "done";
            step.title = completedPhaseTitle(step.title);
          }
          break;
        }
        if (
          event.phase === "clarify" ||
          event.phase === "plan" ||
          event.phase === "reflect"
        ) {
          const row = processRowsByPhase.get(event.phase);
          if (!row) break;
          row.detailLines = [detail];
          if (event.done) {
            row.status = "done";
            row.title = completedPhaseTitle(row.title);
            if (processStatus === row) processStatus = null;
          }
        }
        break;
      }
      case "reflection": {
        settleProcessStatus("done");
        flushCards();
        segments.push({
          kind: "reflection",
          id: `reflection-${seq++}`,
          gaps: event.gaps.slice(),
        });
        break;
      }
      case "research_stats": {
        settleProcessStatus("done");
        flushCards();
        const stats = [
          `检索式 ${event.queriesPlanned} 条`,
          `发现 ${event.urlsDiscovered} 个来源`,
          `采用 ${event.sourcesSelected} 个`,
        ];
        if (event.pagesFetched > 0) {
          stats.push(`读取正文 ${event.pagesFetched} 篇`);
        }
        segments.push({
          kind: "stats",
          id: `stats-${seq++}`,
          label: stats.join(" · "),
        });
        break;
      }
      case "lane_started": {
        settleProcessStatus("done");
        lanes.set(event.laneId, {
          laneId: event.laneId,
          title: event.title,
          index: event.index,
          total: event.total,
          status: "running",
          detailLines: [`调研子问题：${event.title}`],
        });
        break;
      }
      case "lane_progress": {
        const lane = lanes.get(event.laneId);
        if (!lane) break;
        if (event.message) lane.detailLines.push(event.message);
        break;
      }
      case "lane_sources": {
        const lane = lanes.get(event.laneId);
        if (!lane) break;
        lane.sourceList = event.sources.slice();
        break;
      }
      case "lane_done": {
        const lane = lanes.get(event.laneId);
        if (!lane) break;
        lane.status = event.status === "ok" ? "done" : "failed";
        if (event.artifactPath) {
          lane.artifactPath = event.artifactPath;
          lane.detailLines.push(`备忘：${event.artifactPath}`);
        }
        break;
      }
      case "artifact": {
        // Intermediate memos → expandable lane steps; report/other → delivery strip after body.
        if (event.kind === "memo") {
          for (const [, lane] of lanes) {
            if (event.path.includes(`/${lane.laneId}/`)) {
              lane.artifactId = event.id;
              lane.artifactPath = event.path;
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  flushCards();
  return segments;
}

/**
 * True when the run is still active but the workbench has no in-card spinner
 * (e.g. cold-start tools settled, waiting for clarify / plan / next lanes).
 * Callers should render trailing thinking dots so the UI does not look stalled.
 */
export function deepResearchNeedsTrailingActivity(
  segments: DeepResearchSegment[],
  status: ChatMessageDeepResearch["status"] | undefined,
): boolean {
  if (status !== "running") return false;
  for (const segment of segments) {
    if (segment.kind === "tools" && segment.steps.some((step) => step.status === "running")) {
      return false;
    }
    if (segment.kind === "status" && segment.status === "running") {
      return false;
    }
  }
  return true;
}

/**
 * Label for the pre-segment spinner. `clarify` / `plan` phases produce no segment,
 * so their message is the only progress signal the user can get in that window.
 */
export function deepResearchWaitingLabel(events: DeepResearchEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "phase") {
      const message = event.message?.trim();
      if (message) return message;
    }
  }
  return "正在启动深度研究…";
}

/** Legacy content deltas that used to leak into the report body. */
const LEGACY_NARRATIVE_LINES = [
  "我先快速检索最新公开资料，校准调研前提。",
  "现状已校准，再确认一下调研方向。",
  "我先快速确认一下调研方向，然后开始系统检索。",
  "已明确调研方向，开始系统检索。",
  "澄清超时，按默认假设继续。",
  "已跳过确认，按默认假设继续检索。",
  "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
  "发现 1 处信息缺口，正在补充检索。",
  "证据交叉验证充分，未发现需要补搜的缺口。",
];

/** Strip progress sentences from assistant content so only the final report remains. */
export function stripDeepResearchProgressFromContent(content: string): string {
  if (!content) return content;
  let next = content;
  for (const line of LEGACY_NARRATIVE_LINES) {
    next = next.split(line).join("");
  }
  return next.replace(/^\s*\n+/, "").replace(/\n{3,}/g, "\n\n").trimStart();
}
