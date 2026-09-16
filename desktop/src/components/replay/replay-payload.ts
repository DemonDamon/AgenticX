export const MAX_REPLAY_PAYLOAD_BYTES = 256 * 1024;

export type ReplayPayloadDisplay = {
  displayText: string;
  truncated: boolean;
  toolName: string;
  artifactPath: string;
  subagentRunId: string;
};

const MAX_JSON_EXPANSION = 6;
const MAX_DEPTH = 24;

function payloadString(payload: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function buildReplayPayloadDisplay(
  payload: Record<string, unknown> | undefined,
  maxBytes = MAX_REPLAY_PAYLOAD_BYTES,
): ReplayPayloadDisplay {
  if (!payload) {
    return {
      displayText: "",
      truncated: false,
      toolName: "",
      artifactPath: "",
      subagentRunId: "",
    };
  }

  // JSON escaping can expand one UTF-16 character to six ASCII bytes. Keeping
  // a character budget avoids ever stringifying an unbounded payload first.
  const maxChars = Math.max(1, Math.floor(maxBytes / MAX_JSON_EXPANSION));
  const chunks: string[] = [];
  const seen = new WeakSet<object>();
  let remaining = maxChars;
  let truncated = false;

  const append = (value: string): void => {
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (value.length > remaining) {
      chunks.push(value.slice(0, remaining));
      remaining = 0;
      truncated = true;
      return;
    }
    chunks.push(value);
    remaining -= value.length;
  };

  const writeString = (value: string): void => {
    const sliced = value.slice(0, Math.max(0, remaining));
    append(JSON.stringify(sliced));
    if (sliced.length < value.length) truncated = true;
  };

  const write = (value: unknown, depth: number, indent: string): void => {
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      append(JSON.stringify(value));
      return;
    }
    if (typeof value === "string") {
      writeString(value);
      return;
    }
    if (typeof value === "bigint") {
      writeString(value.toString());
      return;
    }
    if (typeof value !== "object") {
      append("null");
      return;
    }
    if (depth >= MAX_DEPTH) {
      writeString("[max depth]");
      truncated = true;
      return;
    }
    if (seen.has(value)) {
      writeString("[circular]");
      truncated = true;
      return;
    }
    seen.add(value);
    const nextIndent = `${indent}  `;
    if (Array.isArray(value)) {
      append("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) append(",");
        append(`\n${nextIndent}`);
        write(value[index], depth + 1, nextIndent);
        if (remaining <= 0) break;
      }
      append(`\n${indent}]`);
      return;
    }
    append("{");
    const entries = Object.entries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) continue;
      if (index > 0) append(",");
      append(`\n${nextIndent}`);
      writeString(entry[0]);
      append(": ");
      write(entry[1], depth + 1, nextIndent);
      if (remaining <= 0) break;
    }
    append(`\n${indent}}`);
  };

  write(payload, 0, "");
  return {
    displayText: chunks.join(""),
    truncated,
    toolName: payloadString(payload, ["name", "tool_name"]),
    artifactPath: payloadString(payload, ["path", "artifact_path", "output_path"]),
    subagentRunId: payloadString(payload, ["run_id", "subagent_run_id"]),
  };
}
