export type EnterpriseBootstrapTransport = {
  apiBaseUrl?: string;
  inferenceApiBaseUrl?: string;
  inferenceTransport?: string;
  reauthRequiredForDirect?: boolean;
};

export type EnterpriseInferenceSelection = {
  ok: true;
  baseUrl: string;
  transport: "gateway-direct-v1" | "portal-proxy-v1";
  reauthRequiredForDirect: boolean;
};

export type EnterpriseInferenceSelectionError = {
  ok: false;
  error: string;
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Choose Desktop inference base from bootstrap control/data plane fields.
 * Never invent a Gateway URL from the Portal host.
 */
export function selectEnterpriseInferenceBase(
  bootstrap: EnterpriseBootstrapTransport,
): EnterpriseInferenceSelection | EnterpriseInferenceSelectionError {
  const inference = String(bootstrap.inferenceApiBaseUrl ?? "").trim();
  const proxy = String(bootstrap.apiBaseUrl ?? "").trim();
  const reauthRequiredForDirect = Boolean(bootstrap.reauthRequiredForDirect);

  if (inference) {
    return {
      ok: true,
      baseUrl: stripTrailingSlash(inference),
      transport: "gateway-direct-v1",
      reauthRequiredForDirect: false,
    };
  }
  if (proxy) {
    return {
      ok: true,
      baseUrl: stripTrailingSlash(proxy),
      transport: "portal-proxy-v1",
      reauthRequiredForDirect,
    };
  }
  return { ok: false, error: "企业推理地址缺失，请重新登录或联系管理员" };
}
