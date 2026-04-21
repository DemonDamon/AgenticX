export function shouldDisableMcpToggle(params: {
  hasSession: boolean;
  isBusy: boolean;
}): boolean {
  const { hasSession } = params;
  return !hasSession;
}
