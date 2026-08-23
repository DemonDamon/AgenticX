import { describe, expect, it } from "vitest";
import type { PortalCapability } from "../capability-packs-reader";
import { hostedMcpEndpoint, withGatewayMcpEndpoints } from "../desktop-capability-endpoints";

const MCP: PortalCapability = {
  id: "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ",
  kind: "mcp",
  name: "market-data",
  displayName: "M",
  requires: [],
  surfaces: ["web", "desktop"],
};

const SKILL: PortalCapability = {
  id: "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0",
  kind: "skill",
  name: "research",
  displayName: "S",
  requires: [],
  surfaces: ["web", "desktop"],
};

describe("withGatewayMcpEndpoints", () => {
  it("attaches the hosted MCP path from the gateway root", () => {
    const [mcp] = withGatewayMcpEndpoints(
      [MCP],
      "https://gateway.example.invalid",
      "test",
    );
    expect(mcp?.endpointUrl).toBe(
      hostedMcpEndpoint("https://gateway.example.invalid", "market-data"),
    );
  });

  it("does not invent an endpoint when the gateway base is empty in production", () => {
    const [mcp] = withGatewayMcpEndpoints([MCP], "", "production");
    expect(mcp?.endpointUrl).toBeUndefined();
  });

  it("leaves skill entries unchanged", () => {
    const [skill] = withGatewayMcpEndpoints(
      [SKILL],
      "https://gateway.example.invalid",
      "test",
    );
    expect(skill?.endpointUrl).toBeUndefined();
  });
});
