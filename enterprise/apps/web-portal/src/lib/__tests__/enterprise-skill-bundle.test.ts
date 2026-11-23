import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "../observability/logger";
import { loadSkillBody } from "../enterprise-skill-bundle";

vi.mock("../observability/logger", () => ({
  log: vi.fn(),
}));

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const ALLOWED = "https://cdn.example.com/a.md";

describe("loadSkillBody", () => {
  afterEach(() => {
    delete process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST;
    vi.mocked(log).mockClear();
  });

  it("rejects non-https, userinfo, and hosts outside the allowlist", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const fetchImpl = async () => jsonResponse(200, "body");
    expect(await loadSkillBody("http://cdn.example.com/SKILL.md", null, fetchImpl)).toBeNull();
    expect(await loadSkillBody("https://user:pass@cdn.example.com/SKILL.md", null, fetchImpl)).toBeNull(); // gitleaks:allow
    expect(await loadSkillBody("https://evil.example/SKILL.md", null, fetchImpl)).toBeNull();
  });

  it("returns null on non-2xx and strips frontmatter on allowlisted https", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    expect(
      await loadSkillBody("https://cdn.example.com/a.md", null, async () => jsonResponse(404, "no")),
    ).toBeNull();
    const body = await loadSkillBody("https://cdn.example.com/a.md", null, async () =>
      jsonResponse(200, "---\nname: x\n---\n步骤"),
    );
    expect(body).toBe("步骤");
  });

  it("rejects a mismatched digest and accepts a prefixed digest", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const raw = "---\nname: a\n---\nhello";
    const hex = createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
    const fetchImpl = async () => jsonResponse(200, raw);

    expect(await loadSkillBody(ALLOWED, "ab".repeat(32), fetchImpl)).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.objectContaining({ event: "chat.skill_bundle_digest_mismatch" }),
    );

    vi.mocked(log).mockClear();
    expect(await loadSkillBody(ALLOWED, `sha256:${hex}`, fetchImpl)).toBe("hello");
    expect(
      vi.mocked(log).mock.calls.some((call) => call[1]?.event === "chat.skill_bundle_digest_mismatch"),
    ).toBe(false);

    expect(await loadSkillBody(ALLOWED, `  SHA256:${hex.toUpperCase()}  `, fetchImpl)).toBe("hello");
  });

  it("rejects a response larger than 256000 bytes", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const body = await loadSkillBody(ALLOWED, null, async () => jsonResponse(200, "x".repeat(300_000)));
    expect(body).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.objectContaining({ event: "chat.skill_bundle_too_large" }),
    );
  });

  it("allows a body when the digest is missing or not 64 hex", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const fetchImpl = async () => jsonResponse(200, "hello");

    expect(await loadSkillBody(ALLOWED, null, fetchImpl)).toBe("hello");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.objectContaining({ event: "chat.skill_bundle_digest_missing" }),
    );
    expect(
      vi.mocked(log).mock.calls.some((call) => call[1]?.event === "chat.skill_bundle_digest_mismatch"),
    ).toBe(false);

    vi.mocked(log).mockClear();
    expect(await loadSkillBody(ALLOWED, "not-a-digest", fetchImpl)).toBe("hello");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.objectContaining({ event: "chat.skill_bundle_digest_missing" }),
    );
    expect(
      vi.mocked(log).mock.calls.some((call) => call[1]?.event === "chat.skill_bundle_digest_mismatch"),
    ).toBe(false);

    vi.mocked(log).mockClear();
    expect(await loadSkillBody(ALLOWED, "a".repeat(63), fetchImpl)).toBe("hello");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.objectContaining({ event: "chat.skill_bundle_digest_missing" }),
    );
    expect(
      vi.mocked(log).mock.calls.some((call) => call[1]?.event === "chat.skill_bundle_digest_mismatch"),
    ).toBe(false);
  });
});
