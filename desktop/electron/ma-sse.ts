export type SseMessage = { id: string | null; event: string; data: string };

/**
 * Incremental SSE parser. Feed decoded text; returns complete messages and the
 * unconsumed remainder (including a partial frame). Comment lines (":" prefix,
 * including ping) are ignored. One optional space after the field colon is
 * stripped. Multiple data lines join with "\n". A blank line dispatches only
 * when at least one data line was seen. Event defaults to "message". id does
 * not carry over to the next message.
 */
export function parseSseChunk(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  let eventName = "message";
  let dataLines: string[] = [];
  let messageId: string | null = null;
  let sawData = false;
  const pendingLines: string[] = [];

  const rawLines = buffer.split("\n");
  const endsWithNewline = buffer.endsWith("\n");
  const completeCount = endsWithNewline ? rawLines.length - 1 : rawLines.length - 1;
  const incomplete = endsWithNewline ? "" : (rawLines[rawLines.length - 1] ?? "");

  const flushPending = () => {
    pendingLines.length = 0;
  };

  for (let index = 0; index < completeCount; index += 1) {
    let line = rawLines[index] ?? "";
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") {
      if (sawData) {
        messages.push({
          id: messageId,
          event: eventName,
          data: dataLines.join("\n"),
        });
      }
      eventName = "message";
      dataLines = [];
      messageId = null;
      sawData = false;
      flushPending();
      continue;
    }
    pendingLines.push(line);
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    let name = line;
    let value = "";
    if (colon >= 0) {
      name = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    if (name === "id") messageId = value;
    else if (name === "event") eventName = value || "message";
    else if (name === "data") {
      dataLines.push(value);
      sawData = true;
    }
  }

  const restParts: string[] = [];
  if (pendingLines.length > 0) restParts.push(`${pendingLines.join("\n")}\n`);
  if (incomplete) restParts.push(incomplete);
  return { messages, rest: restParts.join("") };
}
