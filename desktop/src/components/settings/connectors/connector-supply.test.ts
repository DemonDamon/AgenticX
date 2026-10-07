import { describe, expect, it } from "vitest";
import {
  CONNECTOR_SUPPLY,
  listUnwiredSupply,
  listWiredSupply,
} from "./connector-supply";

describe("connector-supply", () => {
  it("marks only native CLI-backed ids as wired, plus the gateway entry", () => {
    const wired = listWiredSupply();
    expect(wired.some((e) => e.kind === "gateway")).toBe(true);
    const wiredNatives = wired.filter((e) => e.kind === "native").map((e) => e.connectorId);
    expect(wiredNatives.sort()).toEqual(
      ["feishu", "github", "qqmail", "tapd", "tencent-meeting", "wecom"].sort(),
    );
  });

  it("keeps Slack/Discord-class stubs unwired (no fake connected)", () => {
    const unwired = listUnwiredSupply();
    const ids = unwired.map((e) => e.connectorId);
    expect(ids).toContain("slack");
    expect(ids).toContain("notion");
    expect(ids).not.toContain("wecom");
  });

  it("exposes auth types for Task B handshake routing", () => {
    const wecom = CONNECTOR_SUPPLY.find((e) => e.connectorId === "wecom");
    const tapd = CONNECTOR_SUPPLY.find((e) => e.connectorId === "tapd");
    expect(wecom?.auth).toBe("none");
    expect(tapd?.auth).toBe("api_key");
  });
});
