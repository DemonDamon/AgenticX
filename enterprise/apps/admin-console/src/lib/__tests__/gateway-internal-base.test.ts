import { afterEach, describe, expect, it } from "vitest";
import { gatewayInternalBase } from "../gateway-internal-base";

const ORIGINAL_BASE = process.env.GATEWAY_INTERNAL_BASE_URL;
const ORIGINAL_URL = process.env.GATEWAY_INTERNAL_URL;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("gatewayInternalBase", () => {
  afterEach(() => {
    restore("GATEWAY_INTERNAL_BASE_URL", ORIGINAL_BASE);
    restore("GATEWAY_INTERNAL_URL", ORIGINAL_URL);
  });

  it("falls back to the gateway default port when nothing is set", () => {
    delete process.env.GATEWAY_INTERNAL_BASE_URL;
    delete process.env.GATEWAY_INTERNAL_URL;
    expect(gatewayInternalBase()).toBe("http://127.0.0.1:8088");
  });

  it("uses GATEWAY_INTERNAL_URL when it is the only one set", () => {
    delete process.env.GATEWAY_INTERNAL_BASE_URL;
    process.env.GATEWAY_INTERNAL_URL = "http://gw.internal:9000";
    expect(gatewayInternalBase()).toBe("http://gw.internal:9000");
  });

  it("prefers GATEWAY_INTERNAL_BASE_URL and strips trailing slashes", () => {
    process.env.GATEWAY_INTERNAL_BASE_URL = "http://gw.base:8088//";
    process.env.GATEWAY_INTERNAL_URL = "http://gw.internal:9000";
    expect(gatewayInternalBase()).toBe("http://gw.base:8088");
  });
});
