import { describe, expect, it, vi } from "vitest";

vi.mock("./admin-providers-reader", () => ({
  listAvailableModelsForUser: vi.fn(async () => [
    { id: "openai-main/gpt-4o" },
    { id: "zhipu-cn/glm-5" },
    { id: "chinamobile/kimi/kimi-k3" },
  ]),
}));

import { prepareGatewayForward } from "./gateway-forward";

describe("prepareGatewayForward", () => {
  it("keeps provider/model intact for the gateway", async () => {
    const raw = JSON.stringify({
      model: "openai-main/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    const result = await prepareGatewayForward(raw, {
      userId: "u1",
      email: "admin@agenticx.local",
      deptId: null,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.providerHint).toBe("");
    const body = JSON.parse(result.forwardBody) as { model: string };
    expect(body.model).toBe("openai-main/gpt-4o");
  });

  it("keeps nested managed model ids intact", async () => {
    const raw = JSON.stringify({
      model: "chinamobile/kimi/kimi-k3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    const result = await prepareGatewayForward(raw, {
      userId: "u1",
      email: "admin@agenticx.local",
      deptId: null,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.providerHint).toBe("");
    const body = JSON.parse(result.forwardBody) as { model: string };
    expect(body.model).toBe("chinamobile/kimi/kimi-k3");
  });

  it("rejects models outside visibility", async () => {
    const raw = JSON.stringify({ model: "hidden/model", messages: [] });
    const result = await prepareGatewayForward(raw, {
      userId: "u1",
      email: "admin@agenticx.local",
    });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(403);
  });
});
