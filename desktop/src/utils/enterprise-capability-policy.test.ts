import { describe, expect, it } from "vitest";

import {
  isCapabilitySelfServiceOff,
  readCapabilityLocks,
  UNRESTRICTED_CAPABILITY_LOCKS,
} from "./enterprise-capability-policy";

describe("readCapabilityLocks", () => {
  it("leaves an unmanaged desktop completely open", () => {
    for (const raw of [undefined, null, {}, [], "no", 0]) {
      expect(readCapabilityLocks(raw)).toEqual(UNRESTRICTED_CAPABILITY_LOCKS);
    }
  });

  it("locks exactly what the enterprise turned off", () => {
    expect(readCapabilityLocks({ allowMcpAutoDiscovery: false })).toEqual({
      allowLocalSkillInstall: true,
      allowLocalMcpInstall: true,
      allowMcpAutoDiscovery: false,
    });
  });

  it("treats an unrecognized value as unconfigured, not as locked", () => {
    // 读成「关闭」的话，一次字段改名就变成全公司装不了东西，现场还看不出是策略在拦。
    expect(readCapabilityLocks({ allowLocalSkillInstall: "false" })).toEqual(
      UNRESTRICTED_CAPABILITY_LOCKS,
    );
  });
});

describe("isCapabilitySelfServiceOff", () => {
  it("only reports fully managed when nothing self-serve remains", () => {
    expect(isCapabilitySelfServiceOff(UNRESTRICTED_CAPABILITY_LOCKS)).toBe(false);
    expect(
      isCapabilitySelfServiceOff({
        allowLocalSkillInstall: false,
        allowLocalMcpInstall: false,
        allowMcpAutoDiscovery: false,
      }),
    ).toBe(true);
  });
});
