import { describe, expect, it } from "vitest";
import {
  parseStallWaitPayload,
  stallWaitChipText,
  stallWaitRemainingSeconds,
  type StallWaitInfo,
} from "./stall-wait-chip";

const base: StallWaitInfo = {
  attempt: 1,
  maxAttempts: 3,
  waitedSeconds: 180,
  nextRetryInSeconds: 15,
  provider: "custom_openai",
  model: "glm-5.2",
  receivedAtMs: 1_000_000,
};

describe("stall-wait-chip", () => {
  it("counts down from nextRetryInSeconds", () => {
    expect(stallWaitRemainingSeconds(base, base.receivedAtMs)).toBe(15);
    expect(stallWaitRemainingSeconds(base, base.receivedAtMs + 5000)).toBe(10);
    expect(stallWaitRemainingSeconds(base, base.receivedAtMs + 60_000)).toBe(0);
  });

  it("renders Cursor-style waiting copy with attempt and eta", () => {
    expect(stallWaitChipText(base, base.receivedAtMs)).toBe(
      "网络较慢，可能要等待更长时间 · 自动重试 1/3（约 15s 后）",
    );
    expect(stallWaitChipText(base, base.receivedAtMs + 20_000)).toContain("正在重试…");
  });

  it("omits retry part when maxAttempts is zero", () => {
    const info = { ...base, maxAttempts: 0 };
    expect(stallWaitChipText(info, info.receivedAtMs)).toBe("网络较慢，可能要等待更长时间（约 15s 后）");
  });

  it("parses stall_patient_wait payloads and rejects incomplete ones", () => {
    const parsed = parseStallWaitPayload(
      {
        attempt: 2,
        max_attempts: 3,
        waited_seconds: 400,
        next_retry_in_seconds: 30,
        provider: "custom_openai_x",
        model: "glm-5.2",
      },
      123,
    );
    expect(parsed).toEqual({
      attempt: 2,
      maxAttempts: 3,
      waitedSeconds: 400,
      nextRetryInSeconds: 30,
      provider: "custom_openai_x",
      model: "glm-5.2",
      receivedAtMs: 123,
    });
    expect(parseStallWaitPayload({ attempt: 1 }, 0)).toBeNull();
    expect(parseStallWaitPayload(null, 0)).toBeNull();
    expect(parseStallWaitPayload("x", 0)).toBeNull();
  });
});
