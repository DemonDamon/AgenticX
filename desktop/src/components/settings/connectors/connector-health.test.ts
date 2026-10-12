import { describe, expect, it } from "vitest";
import {
  healthPrimaryAction,
  healthShowsInstalled,
  resolveGithubHealth,
} from "./connector-health";

describe("resolveGithubHealth", () => {
  it("marks unwired when not in AVAILABLE set", () => {
    expect(
      resolveGithubHealth({
        wired: false,
        nativeConnected: false,
        mcpConfigured: false,
        mcpAuthOk: null,
      }),
    ).toBe("unwired");
  });

  it("degrades when MCP PAT probe fails even if native gh is OK", () => {
    expect(
      resolveGithubHealth({
        wired: true,
        nativeConnected: true,
        mcpConfigured: true,
        mcpAuthOk: false,
      }),
    ).toBe("degraded");
  });

  it("connects when native OK and MCP not configured", () => {
    expect(
      resolveGithubHealth({
        wired: true,
        nativeConnected: true,
        mcpConfigured: false,
        mcpAuthOk: null,
      }),
    ).toBe("connected");
  });

  it("connects when MCP probe OK", () => {
    expect(
      resolveGithubHealth({
        wired: true,
        nativeConnected: false,
        mcpConfigured: true,
        mcpAuthOk: true,
      }),
    ).toBe("connected");
  });

  it("disconnects when neither native nor MCP works", () => {
    expect(
      resolveGithubHealth({
        wired: true,
        nativeConnected: false,
        mcpConfigured: false,
        mcpAuthOk: null,
      }),
    ).toBe("disconnected");
  });
});

describe("health UI helpers", () => {
  it("only connected shows installed green", () => {
    expect(healthShowsInstalled("connected")).toBe(true);
    expect(healthShowsInstalled("degraded")).toBe(false);
    expect(healthShowsInstalled("disconnected")).toBe(false);
  });

  it("maps CTA by health", () => {
    expect(healthPrimaryAction("degraded")).toBe("reauth");
    expect(healthPrimaryAction("connected")).toBe("manage");
    expect(healthPrimaryAction("disconnected")).toBe("connect");
  });
});
