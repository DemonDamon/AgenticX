import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";

export type ResearchStepKind =
  | "phase"
  | "clarify"
  | "lane"
  | "artifact"
  | "search";

export type ResearchStep = {
  id: string;
  kind: ResearchStepKind;
  title: string;
  subtitle?: string;
  status: "running" | "done" | "failed";
  /** Lines shown when the row is expanded */
  detailLines: string[];
  artifactId?: string;
  artifactPath?: string;
};

function phaseTitle(phase: string, message: string): string {
  if (message?.trim()) return message.trim();
  switch (phase) {
    case "clarify":
      return "确认调研方向";
    case "plan":
      return "规划研究路径";
    case "lanes":
      return "并行检索";
    case "synthesize":
      return "综合分析";
    case "done":
      return "研究完成";
    default:
      return phase;
  }
}

/**
 * Collapse raw SSE events into expandable timeline steps.
 * Clarify Q&A is intentionally omitted here — rendered by DeepResearchClarifyCard.
 */
export function buildDeepResearchSteps(
  events: DeepResearchEvent[],
  status?: ChatMessageDeepResearch["status"],
  clarifyAnswers?: Record<string, string>,
): ResearchStep[] {
  const steps: ResearchStep[] = [];
  const laneMap = new Map<
    string,
    {
      title: string;
      index: number;
      total: number;
      sources?: number;
      status: "running" | "done" | "failed";
      artifactPath?: string;
      artifactId?: string;
      detailLines: string[];
    }
  >();

  let clarifyQuestions: Array<{ questionId: string; question: string }> = [];
  let sawClarifyTimeout = false;
  let sawClarifyEvents = false;

  for (const event of events) {
    switch (event.type) {
      case "run_started":
        break;
      case "phase": {
        if (event.phase === "clarify") {
          // Fold into clarify panel; keep a light prep step only before questions arrive.
          if (!sawClarifyEvents) {
            steps.push({
              id: `phase-clarify-${steps.length}`,
              kind: "phase",
              title: phaseTitle(event.phase, event.message),
              status:
                status === "awaiting_clarify" || status === "running" ? "running" : "done",
              detailLines: [],
            });
          }
          break;
        }
        steps.push({
          id: `phase-${event.phase}-${steps.length}`,
          kind: "phase",
          title: phaseTitle(event.phase, event.message),
          status:
            event.phase === "done"
              ? "done"
              : status === "completed" || status === "failed" || status === "cancelled"
                ? "done"
                : "running",
          detailLines: event.message ? [event.message] : [],
        });
        break;
      }
      case "clarify": {
        sawClarifyEvents = true;
        clarifyQuestions.push({ questionId: event.questionId, question: event.question });
        // Remove the provisional "正在判断是否需要澄清" step once questions exist.
        const prepIdx = steps.findIndex(
          (s) => s.kind === "phase" && s.title.includes("澄清"),
        );
        if (prepIdx >= 0) steps.splice(prepIdx, 1);
        break;
      }
      case "clarify_timeout":
        sawClarifyTimeout = true;
        break;
      case "narrative":
        break;
      case "lane_started": {
        laneMap.set(event.laneId, {
          title: event.title,
          index: event.index,
          total: event.total,
          status: "running",
          detailLines: [`调研子问题：${event.title}`],
        });
        break;
      }
      case "lane_progress": {
        const lane = laneMap.get(event.laneId);
        if (!lane) break;
        if (typeof event.sourcesCollected === "number") {
          lane.sources = event.sourcesCollected;
        }
        if (event.message) lane.detailLines.push(event.message);
        break;
      }
      case "lane_done": {
        const lane = laneMap.get(event.laneId);
        if (!lane) break;
        lane.status = event.status === "ok" ? "done" : "failed";
        if (event.artifactPath) {
          lane.artifactPath = event.artifactPath;
          lane.detailLines.push(`备忘：${event.artifactPath}`);
        }
        break;
      }
      case "artifact": {
        if (event.kind === "memo") {
          for (const [laneId, lane] of laneMap) {
            if (event.path.includes(`/${laneId}/`)) {
              lane.artifactId = event.id;
              lane.artifactPath = event.path;
              lane.detailLines.push(`备忘：${event.title}`);
            }
          }
          break;
        }
        steps.push({
          id: `artifact-${event.id}`,
          kind: "artifact",
          title: event.title,
          subtitle: event.path,
          status: "done",
          detailLines: [`路径：${event.path}`, `大小：${event.bytes} bytes`],
          artifactId: event.id,
          artifactPath: event.path,
        });
        break;
      }
      default:
        break;
    }
  }

  if (sawClarifyEvents) {
    const answered =
      clarifyAnswers && Object.keys(clarifyAnswers).length > 0
        ? Object.entries(clarifyAnswers).map(([id, answer]) => {
            const q = clarifyQuestions.find((item) => item.questionId === id);
            return q ? `${q.question}\n→ ${answer}` : `→ ${answer}`;
          })
        : clarifyQuestions.map((q) => q.question);
    const clarifyDone =
      status !== "awaiting_clarify" || Boolean(clarifyAnswers && Object.keys(clarifyAnswers).length);
    steps.unshift({
      id: "clarify-panel-summary",
      kind: "clarify",
      title: clarifyDone ? "询问工具" : "询问工具",
      subtitle: sawClarifyTimeout
        ? "超时后按默认假设继续"
        : clarifyDone
          ? "已收集信息"
          : "等待确认",
      status: clarifyDone ? "done" : "running",
      detailLines: answered,
    });
  }

  // Emit lane steps in index order after planning phases, before synthesize/report.
  const laneSteps: ResearchStep[] = [...laneMap.entries()]
    .sort((a, b) => a[1].index - b[1].index)
    .map(([laneId, lane]) => ({
      id: `lane-${laneId}`,
      kind: "lane" as const,
      title: "搜索网页",
      subtitle:
        typeof lane.sources === "number"
          ? `${lane.title} · ${lane.sources} 个结果`
          : lane.title,
      status: lane.status,
      detailLines: lane.detailLines,
      artifactPath: lane.artifactPath,
      artifactId: lane.artifactId,
    }));

  // Insert lanes before synthesize / final artifact / done.
  const insertAt = steps.findIndex(
    (s) =>
      (s.kind === "phase" && (s.title.includes("综合") || s.title.includes("完成"))) ||
      s.kind === "artifact",
  );
  if (insertAt < 0) {
    steps.push(...laneSteps);
  } else {
    steps.splice(insertAt, 0, ...laneSteps);
  }

  // Mark earlier running phases as done once later work exists.
  if (laneSteps.length > 0 || status === "completed") {
    for (const step of steps) {
      if (step.kind === "phase" && step.status === "running" && !step.title.includes("综合")) {
        step.status = "done";
      }
    }
  }
  if (status === "completed" || status === "failed" || status === "cancelled") {
    for (const step of steps) {
      if (step.status === "running" && step.kind !== "lane") step.status = "done";
    }
  }

  return steps;
}
