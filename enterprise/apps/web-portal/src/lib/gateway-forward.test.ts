import { describe, expect, it, vi } from "vitest";

vi.mock("./admin-providers-reader", () => ({
  listAvailableModelsForUser: vi.fn(async () => [
    { id: "openai-main/gpt-4o" },
    { id: "zhipu-cn/glm-5" },
  ]),
}));

import { prepareGatewayForward } from "./gateway-forward";

describe("prepareGatewayForward", () => {
  it("splits provider/model and keeps body model bare", async () => {
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
    expect(result.providerHint).toBe("openai-main");
    const body = JSON.parse(result.forwardBody) as { model: string };
    expect(body.model).toBe("gpt-4o");
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
