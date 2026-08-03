import type { DeepResearchEvent } from "@agenticx/core-api";

export function labelForDeepResearchEvent(event: DeepResearchEvent): string {
  switch (event.type) {
    case "run_started":
      return "已启动研究";
    case "phase":
      return event.message || event.phase;
    case "clarify":
      return `澄清 ${event.step}/${event.total}：${event.question}`;
    case "clarify_timeout":
      return "澄清超时，按默认假设继续";
    case "lane_started":
      return `车道 ${event.index}/${event.total}：${event.title}`;
    case "lane_progress":
      return event.message;
    case "lane_done":
      return event.status === "ok"
        ? `车道完成${event.artifactPath ? ` · ${event.artifactPath}` : ""}`
        : "车道失败";
    case "lane_sources":
      return `车道来源 ${event.sources.length} 个`;
    case "artifact":
      return `产物：${event.title}`;
    case "narrative":
      return event.text;
    default: {
      const _exhaustive: never = event;
      return String(_exhaustive);
    }
  }
}
