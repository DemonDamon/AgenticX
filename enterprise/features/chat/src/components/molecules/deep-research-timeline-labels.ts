import type { DeepResearchEvent } from "@agenticx/core-api";
import { getChatCopy, type ChatCopy } from "../../i18n/chat-copy";

export function labelForDeepResearchEvent(
  event: DeepResearchEvent,
  copy: ChatCopy = getChatCopy("zh"),
): string {
  switch (event.type) {
    case "run_started":
      return copy.timeline.runStarted;
    case "phase":
      return event.message || event.phase;
    case "clarify":
      return copy.timeline.clarify(event.step, event.total, event.question);
    case "clarify_timeout":
      return copy.timeline.clarifyTimeout;
    case "lane_started":
      return copy.timeline.laneStarted(event.index, event.total, event.title);
    case "lane_progress":
      return event.message;
    case "lane_done":
      return event.status === "ok"
        ? copy.timeline.laneDone(event.artifactPath)
        : copy.timeline.laneFailed;
    case "lane_sources":
      return copy.timeline.laneSources(event.sources.length);
    case "artifact":
      return copy.timeline.artifact(event.title);
    case "narrative":
      return event.text;
    case "clarify_chat":
    case "research_profile":
    case "research_plan":
    case "reflection":
    case "research_stats":
      return event.type;
    default: {
      const _exhaustive: never = event;
      return String(_exhaustive);
    }
  }
}
