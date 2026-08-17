/** Inputs that distinguish a user-started turn from background / drain sends. */
export type PinScrollOnSendInput = {
  continuation?: unknown;
  queueDrain?: boolean;
};

/**
 * User-started turns should jump to the latest row.
 * Auto-continue and queue drain must keep the user's current scroll.
 */
export function shouldPinScrollOnUserSend(opts?: PinScrollOnSendInput): boolean {
  if (opts?.continuation) return false;
  if (opts?.queueDrain) return false;
  return true;
}

/**
 * Pin follows the user's wheel/trackpad only.
 * Programmatic `scrollTop` assignment must not unpin — new bubbles often
 * fire scroll/resize before layout reaches the true bottom.
 */
export function shouldApplyScrollPinFromEvent(programmatic: boolean): boolean {
  return !programmatic;
}
