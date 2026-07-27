import { describe, expect, it } from "vitest";
import { resolveDesktopInferenceApiBase } from "./desktop-inference-base";

describe("resolveDesktopInferenceApiBase", () => {
  it("normalizes trailing slash and appends /v1", () => {
    const got = resolveDesktopInferenceApiBase({
      configured: "https://gateway.example.invalid/",
      nodeEnv: "production",
    });
    expect(got).toEqual({ ok: true, url: "https://gateway.example.invalid/v1" });
  });

  it("does not duplicate /v1", () => {
    const got = resolveDesktopInferenceApiBase({
      configured: "https://gateway.example.invalid/v1",
      nodeEnv: "production",
    });
    expect(got).toEqual({ ok: true, url: "https://gateway.example.invalid/v1" });
  });

  it("errors in production when missing", () => {
    const got = resolveDesktopInferenceApiBase({ configured: "", nodeEnv: "production" });
    expect(got.ok).toBe(false);
  });

  it("rejects production http non-loopback", () => {
    const got = resolveDesktopInferenceApiBase({
      configured: "http://gateway.example.invalid",
      nodeEnv: "production",
    });
    expect(got.ok).toBe(false);
  });

  it("falls back to loopback in development when missing", () => {
    const got = resolveDesktopInferenceApiBase({ configured: "", nodeEnv: "development" });
    expect(got).toEqual({ ok: true, url: "http://127.0.0.1:8088/v1" });
  });
});
