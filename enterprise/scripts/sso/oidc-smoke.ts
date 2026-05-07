#!/usr/bin/env tsx

/**
 * OIDC 配置基线冒烟脚本（M0 任务产物）。
 *
 * 仅做本地环境变量自检，不发起任何外网请求（不调用 OIDC discovery）。
 *
 * 用法：
 *   pnpm --dir enterprise run sso:oidc-smoke
 *   或：tsx enterprise/scripts/sso/oidc-smoke.ts
 *
 * 退出码：
 *   0 = 所有 provider 配置完整且 issuer 不是占位值
 *   1 = 任一 provider 缺关键字段，或 issuer 仍为 idp.example.com 占位值
 *   2 = NEXT_PUBLIC_SSO_PROVIDERS 未配置，无法继续自检
 */

const REQUIRED_SUFFIXES = ["ISSUER", "CLIENT_ID", "REDIRECT_URI"] as const;
const RECOMMENDED_SUFFIXES = ["CLIENT_SECRET", "ADMIN_REDIRECT_URI", "SCOPES"] as const;
const CLAIM_SUFFIXES = ["CLAIM_EMAIL", "CLAIM_NAME", "CLAIM_DEPT", "CLAIM_ROLES", "CLAIM_EXTERNAL_ID"] as const;

const PLACEHOLDER_ISSUER_HOSTNAME = "idp.example.com";

type ProviderOption = { id: string; name: string };

type CheckResult = {
  ok: boolean;
  notes: string[];
};

function parseProviders(raw: string | undefined): ProviderOption[] {
  const source = raw?.trim();
  if (!source) return [];
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, ...rest] = item.split(":");
      const providerId = id?.trim() ?? "";
      const name = rest.join(":").trim() || providerId;
      return providerId ? { id: providerId, name } : null;
    })
    .filter((item): item is ProviderOption => Boolean(item));
}

function envKey(providerId: string, suffix: string): string {
  const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `SSO_OIDC_${normalized}_${suffix}`;
}

function getEnv(providerId: string, suffix: string): string | undefined {
  return process.env[envKey(providerId, suffix)]?.trim() || undefined;
}

function isExampleIssuer(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname === PLACEHOLDER_ISSUER_HOSTNAME;
  } catch {
    return false;
  }
}

function checkProvider(provider: ProviderOption): CheckResult {
  const notes: string[] = [];
  let ok = true;

  for (const suffix of REQUIRED_SUFFIXES) {
    const value = getEnv(provider.id, suffix);
    if (!value) {
      notes.push(`MISSING required ${envKey(provider.id, suffix)}`);
      ok = false;
    }
  }

  const issuer = getEnv(provider.id, "ISSUER");
  if (issuer && isExampleIssuer(issuer)) {
    notes.push(`PLACEHOLDER issuer (${issuer}) — production discovery will fail; expected behavior at M0 is oidc.provider_not_configured`);
    ok = false;
  }

  for (const suffix of RECOMMENDED_SUFFIXES) {
    const value = getEnv(provider.id, suffix);
    if (!value) {
      notes.push(`note: optional ${envKey(provider.id, suffix)} not set`);
    }
  }

  for (const suffix of CLAIM_SUFFIXES) {
    const value = getEnv(provider.id, suffix);
    if (!value) {
      notes.push(`note: claim ${envKey(provider.id, suffix)} not set; default fallback will be used`);
    }
  }

  return { ok, notes };
}

function checkSharedSecrets(): CheckResult {
  const notes: string[] = [];
  let ok = true;
  const stateSecret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!stateSecret || stateSecret.length < 32) {
    notes.push("MISSING/SHORT SSO_STATE_SIGNING_SECRET (32+ bytes recommended)");
    ok = false;
  }
  const providerKey = process.env.SSO_PROVIDER_SECRET_KEY?.trim();
  if (!providerKey || providerKey.length < 32) {
    notes.push("MISSING/SHORT SSO_PROVIDER_SECRET_KEY (32+ bytes recommended)");
    ok = false;
  }
  return { ok, notes };
}

function main(): number {
  const raw = process.env.NEXT_PUBLIC_SSO_PROVIDERS;
  const providers = parseProviders(raw);

  console.log("[sso:oidc-smoke] === OIDC baseline smoke ===");
  console.log(`[sso:oidc-smoke] NEXT_PUBLIC_SSO_PROVIDERS = ${raw ?? "(unset)"}`);

  if (providers.length === 0) {
    console.log("[sso:oidc-smoke] no providers parsed; SSO buttons will be hidden on login pages");
    return 2;
  }

  const sharedCheck = checkSharedSecrets();
  for (const note of sharedCheck.notes) {
    console.log(`[sso:oidc-smoke] shared: ${note}`);
  }

  let allOk = sharedCheck.ok;
  for (const provider of providers) {
    console.log(`\n[sso:oidc-smoke] provider=${provider.id} display="${provider.name}"`);
    const result = checkProvider(provider);
    for (const note of result.notes) {
      console.log(`[sso:oidc-smoke]   ${note}`);
    }
    if (result.ok) {
      console.log("[sso:oidc-smoke]   status: OK (required fields present, issuer non-placeholder)");
    } else {
      console.log("[sso:oidc-smoke]   status: NOT_READY");
      allOk = false;
    }
  }

  console.log("");
  if (allOk) {
    console.log("[sso:oidc-smoke] all providers ready");
    return 0;
  }
  console.log("[sso:oidc-smoke] one or more providers NOT_READY (login page expected to show oidc.provider_not_configured)");
  return 1;
}

const exitCode = main();
process.exit(exitCode);
