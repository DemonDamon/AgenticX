import { describe, expect, it } from "vitest";
import { projectGatewayRestConnectors } from "./gateway-rest-connectors";

describe("projectGatewayRestConnectors", () => {
  it("keeps only user-origin apps and marks credential presence without secrets", () => {
    const out = projectGatewayRestConnectors(
      {
        apps: [
          { id: "demo", displayName: "Demo", origin: "builtin", authType: "api_key" },
          { id: "shop", displayName: "Mock Shop", origin: "user", authType: "bearer", baseUrl: "http://127.0.0.1:9/api", actionCount: 3 },
          { id: "open", displayName: "", origin: "user", authType: "none" },
          { id: "signed", displayName: "Signed", origin: "user", authType: "hmac" },
        ],
      },
      { connections: [{ id: "c1", connectorId: "shop", name: "x", authType: "bearer" }] },
    );
    expect(out).toEqual([
      { id: "shop", name: "Mock Shop", baseUrl: "http://127.0.0.1:9/api", authType: "bearer", actionCount: 3, hasCredential: true },
      { id: "open", name: "open", authType: "none", hasCredential: true },
      { id: "signed", name: "Signed", authType: "hmac", hasCredential: false },
    ]);
  });

  it("tolerates malformed bodies", () => {
    expect(projectGatewayRestConnectors(null, undefined)).toEqual([]);
    expect(projectGatewayRestConnectors({ apps: "x" }, { connections: null })).toEqual([]);
  });
});
