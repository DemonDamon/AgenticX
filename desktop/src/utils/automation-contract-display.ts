/** Marker prepended by the scheduler before the user's task instruction. */
export const EXECUTION_CONTRACT_HEADER = "## Execution Contract (Auto Injected)";

export type AutomationQueryDisplay = {
  /** The task the user actually wrote. Empty when the message is only the contract. */
  instruction: string;
  /** Contract rules with the markdown bullet prefix removed. */
  contractLines: string[];
};

/**
 * Peel the auto-injected execution contract off a scheduled-task user message.
 * The contract stays available for a compact note; the bubble leads with the task.
 */
export function splitAutomationExecutionContract(text: string): AutomationQueryDisplay {
  const raw = String(text ?? "");
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trimmed = raw.slice(leading.length);
  if (!trimmed.startsWith(EXECUTION_CONTRACT_HEADER)) {
    return { instruction: raw, contractLines: [] };
  }
  const afterHeader = trimmed.slice(EXECUTION_CONTRACT_HEADER.length).replace(/^\r?\n/, "");
  const gap = afterHeader.search(/\n[ \t]*\n/);
  const contractBlock = gap >= 0 ? afterHeader.slice(0, gap) : afterHeader;
  const instruction = gap >= 0 ? afterHeader.slice(gap).replace(/^\s+/, "") : "";
  const contractLines = contractBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
  return { instruction, contractLines };
}
