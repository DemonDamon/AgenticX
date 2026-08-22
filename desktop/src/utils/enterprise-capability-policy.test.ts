import { describe, expect, it } from "vitest";
import {
  isCapabilitySelfServiceOff,
  readCapabilityLocks,
  UNRESTRICTED_CAPABILITY_LOCKS,
} from "./enterprise-capability-policy";

describe("readCapabilityLocks", () => {
  it("defaults to unrestricted when the snapshot is missing or malformed", () => {
    expect(readCapabilityLocks(undefined)).toEqual(UNRESTRICTED_CAPABILITY_LOCKS);
    expect(readCapabilityLocks(null)).toEqual(UNRESTRICTED_CAPABILITY_LOCKS);
    expect(readCapabilityLocks("nope")).toEqual(UNRESTRICTED_CAPABILITY_LOCKS);
  });

  it("only treats an explicit false as locked", () => {
    expect(readCapabilityLocks({ allowMcpAutoDiscovery: false })).toEqual({
      allowLocalSkillInstall: true,
      allowLocalMcpInstall: true,
      allowMcpAutoDiscovery: false,
    });
  });
});

describe("isCapabilitySelfServiceOff", () => {
  it("is false for the unrestricted default", () => {
    expect(isCapabilitySelfServiceOff(UNRESTRICTED_CAPABILITY_LOCKS)).toBe(false);
  });

  it("is true only when every self-service switch is off", () => {
    expect(
      isCapabilitySelfServiceOff({
        allowLocalSkillInstall: false,
        allowLocalMcpInstall: false,
        allowMcpAutoDiscovery: false,
      }),
    ).toBe(true);
  });
});
