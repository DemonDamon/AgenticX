import type { Message, SessionTokens } from "../store";
import { EMPTY_SESSION_TOKENS } from "../store";

/** Rebuild pane sessionTokens from messages that survived a retry/edit trim. */
export function sessionTokensFromMessages(
  messages: ReadonlyArray<Pick<Message, "usage">>,
): SessionTokens {
  let input = 0;
  let output = 0;
  let cached = 0;
  let lastInput = 0;
  let lastCached = 0;
  for (const row of messages) {
    const usage = row.usage;
    if (!usage) continue;
    const inp = Number(usage.inputTokens) || 0;
    const out = Number(usage.outputTokens) || 0;
    const hit = Number(usage.cachedTokens) || 0;
    if (inp <= 0 && out <= 0 && hit <= 0) continue;
    input += Math.max(0, Math.floor(inp));
    output += Math.max(0, Math.floor(out));
    cached += Math.max(0, Math.floor(hit));
    lastInput = Math.max(0, Math.floor(inp));
    lastCached = Math.max(0, Math.floor(hit));
  }
  if (input <= 0 && output <= 0 && cached <= 0) {
    return { ...EMPTY_SESSION_TOKENS };
  }
  return { input, output, cached, lastInput, lastCached };
}
