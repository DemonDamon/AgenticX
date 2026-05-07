import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SamlProtocolHandler } from "../saml-protocol-handler";

const mockGetAuthorizeUrlAsync = vi.fn();
const mockValidatePostResponseAsync = vi.fn();
const SAMLConstructor = vi.fn();

vi.mock("@node-saml/node-saml", async () => {
  return {
    SAML: class {
      public constructor(...args: unknown[]) {
        SAMLConstructor(...args);
      }
      public getAuthorizeUrlAsync(...args: unknown[]) {
        return mockGetAuthorizeUrlAsync(...args);
      }
      public validatePostResponseAsync(...args: unknown[]) {
        return mockValidatePostResponseAsync(...args);
      }
    },
    ValidateInResponseTo: { never: "never", ifPresent: "ifPresent", always: "always" },
  };
});

const provider = {
  providerId: "saml-default",
  idpEntityId: "https://idp.example.org/idp",
  idpSsoUrl: "https://idp.example.org/sso",
  idpCertPemList: ["-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"],
  spEntityId: "https://portal.example.com/saml/metadata",
  acsUrl: "https://portal.example.com/api/auth/sso/saml/callback",
  wantAssertionsSigned: true,
  wantResponseSigned: false,
  clockSkewSeconds: 60,
  attributeMapping: {
    email: "email",
    displayName: "displayName",
    roles: "roles",
    dept: "department",
    externalId: "uid",
  },
};

function buildAuthorizeUrlWithRequestId(requestId: string): string {
  const authnRequestXml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${requestId}" Version="2.0" IssueInstant="2026-05-07T00:00:00.000Z"></samlp:AuthnRequest>`;
  const encodedRequest = Buffer.from(authnRequestXml, "utf8").toString("base64");
  return `https://idp.example.org/sso?SAMLRequest=${encodeURIComponent(encodedRequest)}&RelayState=rel`;
}

function buildSamlResponseWithInResponseTo(inResponseTo: string): string {
  const responseXml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp-1" Version="2.0" IssueInstant="2026-05-07T00:00:00.000Z" InResponseTo="${inResponseTo}"></samlp:Response>`;
  return Buffer.from(responseXml, "utf8").toString("base64");
}

function buildValidatedProfile(inResponseTo: string | null = "_req-ok") {
  return {
    nameID: "uid-1",
    InResponseTo: inResponseTo,
    attributes: {
      email: "owner@AgenticX.Local",
      displayName: "Owner",
      roles: ["member", "policy_admin"],
      department: "Platform",
      uid: "uid-1",
    },
  };
}

describe("SamlProtocolHandler", () => {
  beforeEach(() => {
    SAMLConstructor.mockReset();
    mockGetAuthorizeUrlAsync.mockReset();
    mockValidatePostResponseAsync.mockReset();
  });

  it("startAuthentication issues redirect URL + signed RelayState cookie", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-123"));
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const result = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
      returnTo: "/workspace",
    });
    expect(result.kind).toBe("redirect");
    expect(result.protocol).toBe("saml");
    expect(result.redirectUrl).toContain("https://idp.example.org/sso");
    expect(result.cookie?.name).toBe("agenticx_saml_state_portal");
    expect(result.cookie?.value).not.toContain(provider.providerId);
    expect(result.state.providerId).toBe(provider.providerId);
    expect(result.state.requestId).toBe("_req-123");
    expect(SAMLConstructor).toHaveBeenCalledTimes(1);
    const [constructorInput] = SAMLConstructor.mock.calls[0] ?? [];
    expect(constructorInput).toMatchObject({
      validateInResponseTo: "never",
    });
  });

  it("handleCallback validates RelayState and maps attributes", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-ok"));
    mockValidatePostResponseAsync.mockResolvedValue({
      profile: buildValidatedProfile("_req-ok"),
      loggedOut: false,
    });

    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
      returnTo: "/workspace",
    });

    const result = await handler.handleCallback({
      provider,
      cookieSecret,
      cookieValue: start.cookie?.value,
      samlResponse: buildSamlResponseWithInResponseTo("_req-ok"),
      relayState: start.state.relayState,
    });
    expect(result.protocol).toBe("saml");
    expect(result.identity.email).toBe("owner@agenticx.local");
    expect(result.identity.roleCodeHints).toEqual(["member", "policy_admin"]);
    expect(result.identity.deptHint).toBe("Platform");
  });

  it.each([
    ["invalid signature", "saml.invalid_signature"],
    ["NotOnOrAfter must be after now", "saml.expired_assertion"],
    ["audience mismatch", "saml.invalid_audience"],
    ["issuer mismatch", "saml.invalid_issuer"],
    ["InResponseTo missing", "saml.missing_in_response_to"],
  ])("maps internal error '%s' to %s", async (msg, expectedCode) => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-mapped"));
    mockValidatePostResponseAsync.mockRejectedValue(new Error(msg));

    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
    });
    await expect(
      handler.handleCallback({
        provider,
        cookieSecret,
        cookieValue: start.cookie?.value,
        samlResponse: buildSamlResponseWithInResponseTo("_req-mapped"),
        relayState: start.state.relayState,
      })
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it("rejects providerId mismatch in cookie", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-cookie-mismatch"));
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
    });

    await expect(
      handler.handleCallback({
        provider: { ...provider, providerId: "other" },
        cookieSecret,
        cookieValue: start.cookie?.value,
        samlResponse: buildSamlResponseWithInResponseTo("_req-cookie-mismatch"),
        relayState: start.state.relayState,
      })
    ).rejects.toMatchObject({ code: "saml.relay_state_invalid" });
  });

  it("rejects missing email attribute with saml.attribute_email_missing", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-email"));
    mockValidatePostResponseAsync.mockResolvedValue({
      profile: {
        nameID: "uid-noemail",
        InResponseTo: "_req-email",
        attributes: { displayName: "X" },
      },
    });
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
    });
    await expect(
      handler.handleCallback({
        provider,
        cookieSecret,
        cookieValue: start.cookie?.value,
        samlResponse: buildSamlResponseWithInResponseTo("_req-email"),
        relayState: start.state.relayState,
      })
    ).rejects.toMatchObject({ code: "saml.attribute_email_missing" });
  });

  it("rejects callback when InResponseTo mismatches state.requestId", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-expected"));
    mockValidatePostResponseAsync.mockResolvedValue({
      profile: buildValidatedProfile("_req-actual"),
      loggedOut: false,
    });
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
    });
    await expect(
      handler.handleCallback({
        provider,
        cookieSecret,
        cookieValue: start.cookie?.value,
        samlResponse: buildSamlResponseWithInResponseTo("_req-tampered"),
        relayState: start.state.relayState,
      })
    ).rejects.toMatchObject({ code: "saml.missing_in_response_to" });
    expect(mockValidatePostResponseAsync).toHaveBeenCalledTimes(1);
  });

  it("rejects callback when validated profile misses InResponseTo", async () => {
    mockGetAuthorizeUrlAsync.mockResolvedValue(buildAuthorizeUrlWithRequestId("_req-missing"));
    mockValidatePostResponseAsync.mockResolvedValue({
      profile: buildValidatedProfile(null),
      loggedOut: false,
    });
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    const start = await handler.startAuthentication({
      provider,
      cookieSecret,
      cookieName: "agenticx_saml_state_portal",
    });
    await expect(
      handler.handleCallback({
        provider,
        cookieSecret,
        cookieValue: start.cookie?.value,
        samlResponse: buildSamlResponseWithInResponseTo("_req-missing"),
        relayState: start.state.relayState,
      })
    ).rejects.toMatchObject({ code: "saml.missing_in_response_to" });
  });

  it("startAuthentication throws when cookie secret missing", async () => {
    const handler = new SamlProtocolHandler();
    await expect(
      handler.startAuthentication({
        provider,
        cookieSecret: "",
        cookieName: "agenticx_saml_state_portal",
      })
    ).rejects.toMatchObject({ code: "saml.provider_not_configured" });
  });

  it("buildSamlInstance throws when idpCertPemList empty", async () => {
    const handler = new SamlProtocolHandler();
    const cookieSecret = randomBytes(32).toString("hex");
    await expect(
      handler.startAuthentication({
        provider: { ...provider, idpCertPemList: [] },
        cookieSecret,
        cookieName: "agenticx_saml_state_portal",
      })
    ).rejects.toMatchObject({ code: "saml.provider_not_configured" });
  });
});
