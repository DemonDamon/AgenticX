import { describe, expect, it } from "vitest";

import {
  MaWebhookValidationError,
  MA_WEBHOOK_EVENT_TYPES,
  credentialMatchesExpiryWindow,
  generateSigningSecret,
  normalizeWebhookInput,
} from "../ma-webhooks";

describe("webhook input", () => {
  const base = {
    name: "通知",
    url: "https://hooks.example.com/ma",
    event_types: ["session.idle", "session.idle"],
  };

  it("dedupes event types and rejects empty, unknown, and credentialed urls", () => {
    const input = normalizeWebhookInput(base, "create");
    expect(input.eventTypes).toEqual(["session.idle"]);
    expect(input.includeResultText).toBe(false);
    expect(() => normalizeWebhookInput({ ...base, event_types: [] }, "create")).toThrow("event_types: is required");
    expect(() => normalizeWebhookInput({ ...base, event_types: ["session.started"] }, "create")).toThrow(
      "event_types: is invalid",
    );
    expect(() => normalizeWebhookInput({ ...base, url: "https://u:p@x.example.com/h" }, "create")).toThrow( // gitleaks:allow
      MaWebhookValidationError,
    );
  });

  it("accepts every catalog event and bounds description", () => {
    expect(MA_WEBHOOK_EVENT_TYPES).toHaveLength(29);
    const input = normalizeWebhookInput({ ...base, event_types: [...MA_WEBHOOK_EVENT_TYPES] }, "create");
    expect(input.eventTypes).toEqual([...MA_WEBHOOK_EVENT_TYPES]);
    expect(input.description).toBe("");
    expect(normalizeWebhookInput({ ...base, description: "  值班端点  " }, "create").description).toBe("值班端点");
    expect(normalizeWebhookInput({ ...base, description: "x".repeat(2048) }, "create").description).toHaveLength(2048);
    expect(() => normalizeWebhookInput({ ...base, event_types: ["deployment.created"] }, "create")).toThrow(
      "event_types: is invalid",
    );
    expect(() => normalizeWebhookInput({ ...base, description: "x".repeat(2049) }, "create")).toThrow(
      "description: is too long",
    );
    expect(() => normalizeWebhookInput({ ...base, description: 1 }, "create")).toThrow("description: is invalid");
  });

  it("generates a standard webhook secret", () => {
    expect(generateSigningSecret()).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
  });

  it("keeps only active credentials inside the open-closed expiry window", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    const inside = new Date("2026-10-27T00:00:00.000Z");
    const edge = new Date("2026-10-28T00:00:00.000Z");
    const outside = new Date("2026-10-28T00:00:00.001Z");
    expect(credentialMatchesExpiryWindow("active", inside, now, 72)).toBe(true);
    expect(credentialMatchesExpiryWindow("active", edge, now, 72)).toBe(true);
    expect(credentialMatchesExpiryWindow("active", now, now, 72)).toBe(false);
    expect(credentialMatchesExpiryWindow("active", outside, now, 72)).toBe(false);
    expect(credentialMatchesExpiryWindow("archived", inside, now, 72)).toBe(false);
    expect(credentialMatchesExpiryWindow("active", null, now, 72)).toBe(false);
  });
});
