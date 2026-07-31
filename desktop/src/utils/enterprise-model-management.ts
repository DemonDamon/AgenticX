export type DesktopEnterpriseAccount = {
  loggedIn: boolean;
  baseUrl?: string;
};

/**
 * A remembered enterprise organization puts Desktop in managed onboarding
 * even before the employee finishes browser login. In that state local model
 * creation must wait for the organization to authenticate the user.
 */
export function isEnterpriseModelManagementLocked(account: DesktopEnterpriseAccount): boolean {
  return !account.loggedIn && Boolean(account.baseUrl?.trim());
}
