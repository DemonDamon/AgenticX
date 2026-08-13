import { describe, expect, it } from "vitest";
import { selectEnterpriseInferenceBase } from "../electron/enterprise-routing";

describe("selectEnterpriseInferenceBase", () => {
  it("prefers gateway direct when inferenceApiBaseUrl is present", () => {
    const got = selectEnterpriseInferenceBase({
      apiBaseUrl: "https://portal.example.invalid/api/desktop/v1",
      inferenceApiBaseUrl: "https://gateway.example.invalid/v1/",
      inferenceTransport: "gateway-direct-v1",
    });
    expect(got).toEqual({
      ok: true,
      baseUrl: "https://gateway.example.invalid/v1",
      transport: "gateway-direct-v1",
      reauthRequiredForDirect: false,
    });
  });

  it("falls back to portal proxy for old bootstrap", () => {
    const got = selectEnterpriseInferenceBase({
      apiBaseUrl: "https://portal.example.invalid/api/desktop/v1",
      reauthRequiredForDirect: true,
    });
    expect(got).toEqual({
      ok: true,
      baseUrl: "https://portal.example.invalid/api/desktop/v1",
      transport: "portal-proxy-v1",
      reauthRequiredForDirect: true,
    });
  });

  it("prefers trusted portal api base over bootstrap proxy base", () => {
    const got = selectEnterpriseInferenceBase({
      apiBaseUrl: "http://portal.example.invalid/api/desktop/v1",
      portalApiBaseUrl: "https://portal.example.invalid:3000/api/desktop/v1",
      reauthRequiredForDirect: true,
    });
    expect(got).toEqual({
      ok: true,
      baseUrl: "https://portal.example.invalid:3000/api/desktop/v1",
      transport: "portal-proxy-v1",
      reauthRequiredForDirect: true,
    });
  });

  it("rejects empty addresses", () => {
    const got = selectEnterpriseInferenceBase({});
    expect(got.ok).toBe(false);
  });
});
