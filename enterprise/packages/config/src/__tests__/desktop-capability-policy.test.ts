import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_CAPABILITY_POLICY,
  isFullyManagedDesktop,
  normalizeDesktopCapabilityPolicy,
} from "../desktop-capability-policy";

describe("normalizeDesktopCapabilityPolicy", () => {
  it("leaves a tenant that never configured this exactly as it was", () => {
    // 这三个开关是后加的。没配过就必须和加它们之前一样，否则老租户升级后员工突然
    // 装不了东西，而管理员根本没动过这一项。
    for (const raw of [undefined, null, {}, [], "nope", 42]) {
      expect(normalizeDesktopCapabilityPolicy(raw)).toEqual(DEFAULT_DESKTOP_CAPABILITY_POLICY);
    }
  });

  it("honours an explicit lockdown", () => {
    expect(
      normalizeDesktopCapabilityPolicy({
        allowLocalSkillInstall: false,
        allowLocalMcpInstall: false,
        allowMcpAutoDiscovery: false,
      }),
    ).toEqual({
      allowLocalSkillInstall: false,
      allowLocalMcpInstall: false,
      allowMcpAutoDiscovery: false,
    });
  });

  it("locks only what was actually turned off", () => {
    expect(normalizeDesktopCapabilityPolicy({ allowMcpAutoDiscovery: false })).toEqual({
      allowLocalSkillInstall: true,
      allowLocalMcpInstall: true,
      allowMcpAutoDiscovery: false,
    });
  });

  it("treats a malformed value as unconfigured rather than as off", () => {
    // 把「配歪了」读成「关闭」会静默锁死一个租户，而且现场极难查。
    expect(
      normalizeDesktopCapabilityPolicy({
        allowLocalSkillInstall: "false",
        allowLocalMcpInstall: 0,
        allowMcpAutoDiscovery: null,
      }),
    ).toEqual(DEFAULT_DESKTOP_CAPABILITY_POLICY);
  });
});

describe("isFullyManagedDesktop", () => {
  it("is true only when nothing self-serve is left", () => {
    expect(isFullyManagedDesktop(DEFAULT_DESKTOP_CAPABILITY_POLICY)).toBe(false);
    expect(
      isFullyManagedDesktop({
        allowLocalSkillInstall: false,
        allowLocalMcpInstall: false,
        allowMcpAutoDiscovery: true,
      }),
    ).toBe(false);
    expect(
      isFullyManagedDesktop({
        allowLocalSkillInstall: false,
        allowLocalMcpInstall: false,
        allowMcpAutoDiscovery: false,
      }),
    ).toBe(true);
  });
});
