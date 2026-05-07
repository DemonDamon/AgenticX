type ProviderLike = {
  protocol: "oidc" | "saml";
  enabled?: boolean;
};

export function shouldDisableSamlHealthCheck(item: Pick<ProviderLike, "protocol">, samlGloballyDisabled: boolean): boolean {
  return item.protocol === "saml" && samlGloballyDisabled;
}

export function shouldDisableSamlToggle(
  item: Pick<ProviderLike, "protocol" | "enabled">,
  samlGloballyDisabled: boolean
): boolean {
  if (item.protocol !== "saml" || !samlGloballyDisabled) return false;
  return !item.enabled;
}
