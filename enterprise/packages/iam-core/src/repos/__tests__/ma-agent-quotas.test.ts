import { describe, expect, it } from "vitest";

import { MaAgentQuotaValidationError, normalizeAgentQuotaInput } from "../ma-agent-quotas";

const AGENT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function body(patch: Record<string, unknown> = {}) {
  return {
    agent_id: AGENT,
    subject: "default",
    daily_tokens: 1,
    weekly_tokens: 0,
    monthly_tokens: 0,
    ...patch,
  };
}

describe("normalizeAgentQuotaInput", () => {
  it("rejects a negative daily limit", () => {
    expect(() => normalizeAgentQuotaInput(body({ daily_tokens: -1 }))).toThrow(MaAgentQuotaValidationError);
  });

  it("rejects a fractional limit", () => {
    expect(() => normalizeAgentQuotaInput(body({ daily_tokens: 1.5 }))).toThrow(MaAgentQuotaValidationError);
  });

  it("rejects a limit above 1e12", () => {
    expect(() => normalizeAgentQuotaInput(body({ daily_tokens: 1e13 }))).toThrow(MaAgentQuotaValidationError);
  });

  it("rejects an unknown subject", () => {
    expect(() => normalizeAgentQuotaInput(body({ subject: "dept" }))).toThrow(MaAgentQuotaValidationError);
  });
});
