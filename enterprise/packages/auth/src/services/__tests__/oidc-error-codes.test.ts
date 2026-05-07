import { describe, expect, it } from "vitest";
import {
  getPortalSsoErrorMessageEn,
  getPortalSsoErrorMessageZh,
  OIDC_ERROR_CODES,
  OIDC_PORTAL_ERROR_MESSAGES_EN,
  OIDC_PORTAL_ERROR_MESSAGES_ZH,
} from "../oidc-error-codes";

describe("oidc-error-codes", () => {
  it("includes SAML start/state errors in portal error maps", () => {
    expect(OIDC_PORTAL_ERROR_MESSAGES_EN["saml.state_secret_missing"]).toBeTruthy();
    expect(OIDC_PORTAL_ERROR_MESSAGES_EN["saml.start_failed"]).toBeTruthy();
    expect(OIDC_PORTAL_ERROR_MESSAGES_ZH["saml.state_secret_missing"]).toBeTruthy();
    expect(OIDC_PORTAL_ERROR_MESSAGES_ZH["saml.start_failed"]).toBeTruthy();
  });

  it("resolves localized message for new SAML errors", () => {
    expect(getPortalSsoErrorMessageEn("saml.state_secret_missing")).toContain("secret");
    expect(getPortalSsoErrorMessageZh("saml.start_failed")).toContain("SAML");
    expect(OIDC_ERROR_CODES).toContain("saml.state_secret_missing");
    expect(OIDC_ERROR_CODES).toContain("saml.start_failed");
  });
});
