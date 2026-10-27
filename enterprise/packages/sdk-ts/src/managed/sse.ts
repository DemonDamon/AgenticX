export type SseFrame = { id: string | null; event: string; data: string };

function splitField(line: string): [string, string] {
  const index = line.indexOf(":");
  if (index < 0) return [line, ""];
  let value = line.slice(index + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  return [line.slice(0, index), value];
}

/** Parse text/event-stream. A blank line dispatches a frame that has at least one data line. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let messageId: string | null = null;
  let sawData = false;

  const takeLine = (rawLine: string): SseFrame | null => {
    let line = rawLine;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") {
      const frame = sawData ? { id: messageId, event: eventName, data: dataLines.join("\n") } : null;
      eventName = "message";
      dataLines = [];
      messageId = null;
      sawData = false;
      return frame;
    }
    if (line.startsWith(":")) return null;
    const [name, value] = splitField(line);
    if (name === "id") messageId = value;
    else if (name === "event") eventName = value || "message";
    else if (name === "data") {
      dataLines.push(value);
      sawData = true;
    }
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      if (value) buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const frame = takeLine(line);
        if (frame) yield frame;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already have been cancelled by the consumer.
    }
  }
}
