export type DesktopEnterpriseAccount = {
  loggedIn: boolean;
  baseUrl?: string;
};

/**
 * Local model credentials remain available until enterprise authentication
 * actually succeeds. Remembering an organization URL is only an onboarding
 * convenience and must not make an otherwise local Desktop unusable.
 */
export function isEnterpriseModelManagementLocked(account: DesktopEnterpriseAccount): boolean {
  return account.loggedIn;
}
