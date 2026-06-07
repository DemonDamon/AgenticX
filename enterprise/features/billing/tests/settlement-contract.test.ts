import { describe, expect, it, vi, afterEach } from "vitest";
import { SettlementContractService } from "../src/services/settlement-contract";

describe("SettlementContractService.notifySplit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips webhook when not configured without throwing (AC-3)", async () => {
    const service = new SettlementContractService("postgresql://invalid:5432/nodb");
    const result = await service.notifySplit({
      tenant_id: "tenant-test",
      usage_record_id: "usage-1",
      rule_id: "rule-1",
      entries: [{ participant_id: "platform", amount_micro_usd: "1000000" }],
    });
    expect(result.dispatched).toBe(false);
  });

  it("dispatches when webhook enabled and returns ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 }))
    );
    const service = new SettlementContractService("postgresql://invalid:5432/nodb");
    vi.spyOn(service, "getConfig").mockResolvedValue({
      tenant_id: "tenant-test",
      webhook_url: "https://example.com/hook",
      enabled: true,
      updated_at: new Date().toISOString(),
    });
    vi.spyOn(service as unknown as { recordEvent: () => Promise<string> }, "recordEvent").mockResolvedValue("evt-1");

    const result = await service.notifySplit({
      tenant_id: "tenant-test",
      usage_record_id: "usage-1",
      rule_id: "rule-1",
      entries: [{ participant_id: "platform", amount_micro_usd: "1000000" }],
    });
    expect(result.dispatched).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
