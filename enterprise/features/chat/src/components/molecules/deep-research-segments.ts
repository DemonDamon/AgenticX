import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import type { ResearchStep } from "./deep-research-steps";

export type DeepResearchSegment =
  | { kind: "narrative"; id: string; text: string }
  | { kind: "clarify"; id: string }
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
    };

export type DeepResearchArtifactEvent = Extract<DeepResearchEvent, { type: "artifact" }>;

type LaneDraft = {
  laneId: string;
  title: string;
  index: number;
  total: number;
  sources?: number;
  status: "running" | "done" | "failed";
  artifactPath?: string;
  artifactId?: string;
  detailLines: string[];
};

function laneToStep(lane: LaneDraft): ResearchStep {
  return {
    id: `lane-${lane.laneId}`,
    kind: "lane",
    title: "搜索网页",
    subtitle:
      typeof lane.sources === "number"
        ? `${lane.title} · ${lane.sources} 个结果`
        : lane.title,
    status: lane.status,
    detailLines: lane.detailLines,
    artifactPath: lane.artifactPath,
    artifactId: lane.artifactId,
  };
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
  let toolsTitle = "正在并行检索…";
  let toolsId = "tools-1";
  let lanes = new Map<string, LaneDraft>();
  let seq = 0;

  const flushTools = () => {
    if (lanes.size === 0) return;
    const steps = [...lanes.values()]
      .sort((a, b) => a.index - b.index)
      .map(laneToStep);
    segments.push({
      kind: "tools",
      id: toolsId,
      title: toolsTitle,
      steps,
    });
    lanes = new Map();
    toolsId = `tools-${++seq}`;
  };

  for (const event of events) {
    switch (event.type) {
      case "run_started":
        break;
      case "narrative": {
        flushTools();
        const text = event.text.trim();
        if (text) {
          segments.push({ kind: "narrative", id: `narrative-${seq++}`, text });
        }
        break;
      }
      case "clarify": {
        if (!clarifyPushed) {
          flushTools();
          segments.push({ kind: "clarify", id: "clarify" });
          clarifyPushed = true;
        }
        break;
      }
      case "clarify_timeout":
        break;
      case "phase": {
        if (event.phase === "clarify" || event.phase === "plan") {
          break;
        }
        if (event.phase === "lanes") {
          flushTools();
          toolsTitle = event.message || "正在并行检索…";
          break;
        }
        if (event.phase === "synthesize" || event.phase === "done") {
          flushTools();
          const terminal =
            event.phase === "done" ||
            status === "completed" ||
            status === "failed" ||
            status === "cancelled";
          segments.push({
            kind: "status",
            id: `phase-${event.phase}-${seq++}`,
            title: event.message || event.phase,
            status: status === "failed" ? "failed" : terminal ? "done" : "running",
            detailLines: event.message ? [event.message] : [],
          });
        }
        break;
      }
      case "lane_started": {
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
        if (typeof event.sourcesCollected === "number") lane.sources = event.sourcesCollected;
        if (event.message) lane.detailLines.push(event.message);
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

  flushTools();
  return segments;
}

/** Legacy content deltas that used to leak into the report body. */
const LEGACY_NARRATIVE_LINES = [
  "我先快速确认一下调研方向，然后开始系统检索。",
  "已明确调研方向，开始系统检索。",
  "澄清超时，按默认假设继续。",
  "已跳过确认，按默认假设继续检索。",
  "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
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
