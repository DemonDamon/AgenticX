export type SkillInstallRequestDecision = "start" | "queue" | "ignore";

/**
 * Decide whether a marketplace install can start immediately.
 *
 * A skill waiting for user confirmation still owns the single install slot. Keeping
 * that state separate from the network busy flag prevents a second click from
 * replacing the pending confirmation dialog.
 */
export function decideSkillInstallRequest(input: {
  requestedKey: string;
  activeKey: string | null;
  confirmationKey: string | null;
  queuedKeys: readonly string[];
}): SkillInstallRequestDecision {
  const { requestedKey, activeKey, confirmationKey, queuedKeys } = input;
  if (
    requestedKey === activeKey ||
    requestedKey === confirmationKey ||
    queuedKeys.includes(requestedKey)
  ) {
    return "ignore";
  }
  if (activeKey || confirmationKey) return "queue";
  return "start";
}
