import { describe, expect, it } from "vitest";
import { resolveAdminConsoleUrl } from "../admin-console-url";

describe("resolveAdminConsoleUrl", () => {
  it("prefers explicit NEXT_PUBLIC_ADMIN_CONSOLE_URL when non-empty", () => {
    expect(
      resolveAdminConsoleUrl(" https://admin.example.com ", {
        protocol: "https:",
        hostname: "portal.example.com",
        port: "",
      }),
    ).toBe("https://admin.example.com");
  });

  it("maps local dev :3000 to :3001 when unset or empty", () => {
    expect(
      resolveAdminConsoleUrl("", {
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      }),
    ).toBe("http://localhost:3001");
  });

  it("maps production HTTP portal to independent admin HTTP port :8081", () => {
    expect(
      resolveAdminConsoleUrl("", {
        protocol: "http:",
        hostname: "10.0.0.12",
        port: "",
      }),
    ).toBe("http://10.0.0.12:8081");
  });

  it("maps production HTTPS portal to independent admin HTTPS port :8443", () => {
    expect(
      resolveAdminConsoleUrl(undefined, {
        protocol: "https:",
        hostname: "portal.example.com",
        port: "",
      }),
    ).toBe("https://portal.example.com:8443");
  });

  it("falls back to http://localhost:3001 outside browser", () => {
    expect(resolveAdminConsoleUrl("", undefined)).toBe("http://localhost:3001");
  });
});
