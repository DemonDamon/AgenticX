/** Helpers for detecting / reconnecting in-progress deep-research runs. */

import { getChatCopy, type ChatCopy } from "../i18n/chat-copy";

export type ActiveDeepResearchRun = {
  runId: string;
  sessionId: string;
  status: "running" | "awaiting_clarify" | string;
  phase: string;
  topic: string;
  updatedAt: string;
};

export function phaseLabel(phase: string, copy: ChatCopy = getChatCopy("zh")): string {
  const map: Record<string, string> = {
    recon: copy.phases.recon,
    clarify: copy.phases.clarify,
    plan: copy.phases.plan,
    lanes: copy.phases.lanes,
    reflect: copy.phases.reflect,
    synthesize: copy.phases.synthesize,
    done: copy.phases.done,
  };
  return map[phase] ?? phase;
}

/** @deprecated use phaseLabel */
export function phaseLabelZh(phase: string): string {
  return phaseLabel(phase);
}

export async function fetchActiveDeepResearchRuns(
  sessionId?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ActiveDeepResearchRun[]> {
  try {
    const qs = sessionId?.trim()
      ? `?sessionId=${encodeURIComponent(sessionId.trim())}`
      : "";
    const res = await fetchImpl(`/api/chat/deep-research/runs${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { runs?: ActiveDeepResearchRun[] };
    };
    return Array.isArray(json.data?.runs) ? json.data!.runs! : [];
  } catch {
    return [];
  }
}

export function activeRunReconnectUrl(runId: string): string {
  return `/api/chat/deep-research/runs/${encodeURIComponent(runId)}/stream`;
}
