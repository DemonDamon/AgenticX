/** A task is fresh until the user or the assistant has spoken in it. */
export function isFreshTask(messages: ReadonlyArray<{ role?: string }>): boolean {
  return !messages.some((message) => message.role === "user" || message.role === "assistant");
}

/** On a fresh task only the browser can be opened. Other tools need a started task. */
export function workspaceToolLocked(kind: string, freshTask: boolean): boolean {
  return freshTask && kind !== "browser";
}
