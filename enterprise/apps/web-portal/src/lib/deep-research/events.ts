import type { DeepResearchEvent } from "@agenticx/sdk-ts";

export function formatDeepResearchEventSse(event: DeepResearchEvent): string {
  return `data: ${JSON.stringify({ agenticx_deep_research_event: event })}\n\n`;
}
