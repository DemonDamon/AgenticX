import { OidcClientService, decryptSecret } from "@agenticx/auth";
import { getSsoProviderById } from "@agenticx/iam-core";
import { X509Certificate } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { assertSafeIssuerUrl } from "../../../../../../../lib/sso-url-guard";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function isSamlGloballyDisabled(): boolean {
  return process.env.SSO_SAML_DISABLED?.trim().toLowerCase() === "true";
}

type OidcHealthDetail = {
  protocol: "oidc";
  reachable: boolean;
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  signingAlgorithms?: string[];
  error?: string;
};

type SamlCertHealth = {
  index: number;
  subject?: string | null;
  issuer?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  expired: boolean;
  notYetValid: boolean;
};

type SamlHealthDetail = {
  protocol: "saml";
  certs: SamlCertHealth[];
  ssoUrlReachable: boolean | null;
  ssoUrlStatus?: number | null;
  ssoUrlError?: string;
};

export async function POST(_request: Request, context: RouteParams) {
  const guard = await requireAdminScope(["sso:manage"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const provider = await getSsoProviderById(guard.session.tenantId, id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }
  if (provider.protocol === "saml" && isSamlGloballyDisabled()) {
    return NextResponse.json(
      { code: "40000", message: "当前 SAML 已被一键回退，禁止执行 SAML 健康检查" },
      { status: 400 }
    );
  }

  if (provider.protocol === "oidc") {
    if (!provider.issuer || !provider.clientId || !provider.redirectUri) {
      return NextResponse.json(
        { code: "40000", message: "OIDC provider missing required fields (issuer/clientId/redirectUri)" },
        { status: 400 }
      );
    }
    const detail: OidcHealthDetail = {
      protocol: "oidc",
      reachable: false,
      issuer: provider.issuer,
    };
    try {
      await assertSafeIssuerUrl(provider.issuer);
      const secretKey = process.env.SSO_PROVIDER_SECRET_KEY?.trim();
      const service = new OidcClientService();
      const config = await service.getConfiguration({
        providerId: provider.providerId,
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret:
          provider.clientSecretEncrypted && secretKey
            ? decryptSecret(provider.clientSecretEncrypted, secretKey)
            : undefined,
        redirectUri: provider.redirectUri,
        scopes: provider.scopes,
        claimMapping: { email: `${provider.claimMapping.email ?? "email"}` },
      });
      const meta = (config as unknown as {
        metadata?: {
          authorization_endpoint?: string;
          token_endpoint?: string;
          jwks_uri?: string;
          id_token_signing_alg_values_supported?: string[];
        };
        serverMetadata?: () => {
          authorization_endpoint?: string;
          token_endpoint?: string;
          jwks_uri?: string;
          id_token_signing_alg_values_supported?: string[];
        };
      });
      const m = meta.metadata ?? meta.serverMetadata?.();
      detail.reachable = true;
      detail.authorizationEndpoint = m?.authorization_endpoint;
      detail.tokenEndpoint = m?.token_endpoint;
      detail.jwksUri = m?.jwks_uri;
      detail.signingAlgorithms = m?.id_token_signing_alg_values_supported;
    } catch (error) {
      detail.error = error instanceof Error ? error.message : `${error}`;
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { health: detail } });
  }

  const samlConfig = provider.samlConfig;
  if (!samlConfig) {
    return NextResponse.json(
      { code: "40000", message: "SAML provider missing samlConfig" },
      { status: 400 }
    );
  }

  const certs: SamlCertHealth[] = (samlConfig.idpCertPemList ?? []).map((pem, index) => {
    try {
      const cert = new X509Certificate(pem);
      const validFrom = new Date(cert.validFrom);
      const validTo = new Date(cert.validTo);
      const now = new Date();
      return {
        index,
        subject: cert.subject ?? null,
        issuer: cert.issuer ?? null,
        validFrom: cert.validFrom ?? null,
        validTo: cert.validTo ?? null,
        expired: validTo.getTime() < now.getTime(),
        notYetValid: validFrom.getTime() > now.getTime(),
      };
    } catch {
      return {
        index,
        subject: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        expired: true,
        notYetValid: false,
      };
    }
  });

  let ssoUrlReachable: boolean | null = null;
  let ssoUrlStatus: number | null = null;
  let ssoUrlError: string | undefined;
  try {
    await assertSafeIssuerUrl(samlConfig.idpSsoUrl);
    const target = new URL(samlConfig.idpSsoUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(target.toString(), {
        method: "HEAD",
        signal: controller.signal,
        redirect: "manual",
      });
      ssoUrlStatus = response.status;
      ssoUrlReachable = response.status > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    ssoUrlReachable = false;
    ssoUrlError = error instanceof Error ? error.message : `${error}`;
  }

  const detail: SamlHealthDetail = {
    protocol: "saml",
    certs,
    ssoUrlReachable,
    ssoUrlStatus,
    ssoUrlError,
  };
  return NextResponse.json({ code: "00000", message: "ok", data: { health: detail } });
}
