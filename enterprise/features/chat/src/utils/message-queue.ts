export const MESSAGE_QUEUE_DOUBLE_ENTER_MS = 400;

export function isStreamActive(status: string): boolean {
  return status === "sending" || status === "streaming";
}

export function shouldEnqueueOnResend(opts: { isStreamActive: boolean; forceSend?: boolean }): boolean {
  if (opts.forceSend) return false;
  return opts.isStreamActive;
}

export function isDoubleEnterWithinWindow(lastEnterAtMs: number, nowMs: number = Date.now()): boolean {
  if (lastEnterAtMs <= 0) return false;
  return nowMs - lastEnterAtMs <= MESSAGE_QUEUE_DOUBLE_ENTER_MS;
}
