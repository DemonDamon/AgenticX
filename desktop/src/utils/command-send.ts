/**
 * Composer slash-command text helpers.
 */

export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function buildCommandSendText(instructions: string, extra: string): string {
  const body = instructions.trim();
  const note = extra.trim();
  if (!note) return body;
  return `${body}\n\n${note}`;
}

export function splitCommandBody(content: string): { instructions: string; extra: string } {
  const index = content.indexOf("\n\n");
  if (index < 0) return { instructions: content, extra: "" };
  return { instructions: content.slice(0, index), extra: content.slice(index + 2) };
}

export function composeRoomCommandSend(
  command: { kind: string; instructions: string } | null,
  draft: string,
): string {
  const extra = draft.trim();
  if (!command || command.kind !== "prompt") return extra;
  return buildCommandSendText(command.instructions, extra);
}

export function filterCommands<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const prefix = items.filter((item) => item.name.startsWith(q));
  const contains = items.filter((item) => !item.name.startsWith(q) && item.name.includes(q));
  return [...prefix, ...contains];
}
