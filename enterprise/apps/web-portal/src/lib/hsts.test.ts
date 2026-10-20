import { afterEach, describe, expect, it, vi } from "vitest";

const IGNORED_MAX_AGE =
  "[security-headers] PORTAL_HSTS_MAX_AGE must be a non-negative integer number of seconds; it is ignored";

async function loadResolve() {
  vi.resetModules();
  const mod = await import("./hsts");
  return mod.resolveHstsHeader;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveHstsHeader", () => {
  it("returns null when unset", async () => {
    const resolveHstsHeader = await loadResolve();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHstsHeader({})).toBeNull();
    expect(resolveHstsHeader({ NODE_ENV: "production" })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("formats a positive max-age", async () => {
    const resolveHstsHeader = await loadResolve();
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "31536000" })).toBe("max-age=31536000");
  });

  it("allows 0 so browsers can drop a cached policy", async () => {
    const resolveHstsHeader = await loadResolve();
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "0" })).toBe("max-age=0");
  });

  it.each(["abc", "-1", " "])("rejects %j without echoing the value", async (value) => {
    const resolveHstsHeader = await loadResolve();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: value })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toBe(IGNORED_MAX_AGE);
    expect(message).not.toContain(JSON.stringify(value));
    if (value.trim()) expect(message).not.toContain(value);
  });

  it("warns once per invalid value in the same process", async () => {
    const resolveHstsHeader = await loadResolve();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "abc" })).toBeNull();
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "abc" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("abc");
  });

  it("falls back to PORTAL_HSTS_DEFAULT_MAX_AGE when PORTAL_HSTS_MAX_AGE is empty", async () => {
    const resolveHstsHeader = await loadResolve();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHstsHeader({ PORTAL_HSTS_DEFAULT_MAX_AGE: "31536000" })).toBe("max-age=31536000");
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "", PORTAL_HSTS_DEFAULT_MAX_AGE: "120" })).toBe("max-age=120");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not use the default when PORTAL_HSTS_MAX_AGE is invalid", async () => {
    const resolveHstsHeader = await loadResolve();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHstsHeader({ PORTAL_HSTS_MAX_AGE: "abc", PORTAL_HSTS_DEFAULT_MAX_AGE: "60" })).toBeNull();
  });
});
