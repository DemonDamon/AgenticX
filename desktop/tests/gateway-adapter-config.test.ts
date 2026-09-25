import { describe, expect, it } from "vitest";
import { mergeGatewayAdapters, readGatewayAdapterForm, emptyGatewayAdapterForm } from "../electron/gateway-adapter-config";

describe("gateway adapter config", () => {
  it("keeps existing gateway client fields and stores the dingtalk secret", () => {
    const form = emptyGatewayAdapterForm();
    form.dingtalk = { enabled: true, appSecret: "sek" };
    const merged = mergeGatewayAdapters({ gateway: { enabled: true, url: "http://127.0.0.1:9" } }, form);
    expect(merged.gateway?.url).toBe("http://127.0.0.1:9");
    expect(merged.gateway?.adapters?.dingtalk.app_secret).toBe("sek");
    const loaded = readGatewayAdapterForm(merged);
    expect(loaded.dingtalk.appSecret).toBe("sek");
    expect(loaded.dingtalk.enabled).toBe(true);
  });
});
