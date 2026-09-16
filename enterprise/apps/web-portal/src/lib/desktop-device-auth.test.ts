import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureDesktopDeviceAuthFresh = vi.fn();
const verifyDesktopDeviceSecret = vi.fn();
const claimApprovedDeviceAuth = vi.fn();
const createPat = vi.fn();
const completeDesktopDeviceAuth = vi.fn();
const getAdminUser = vi.fn();
const releaseDeviceAuthClaim = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  ensureDesktopDeviceAuthFresh: (...args: unknown[]) => ensureDesktopDeviceAuthFresh(...args),
  verifyDesktopDeviceSecret: (...args: unknown[]) => verifyDesktopDeviceSecret(...args),
  claimApprovedDeviceAuth: (...args: unknown[]) => claimApprovedDeviceAuth(...args),
  createPat: (...args: unknown[]) => createPat(...args),
  completeDesktopDeviceAuth: (...args: unknown[]) => completeDesktopDeviceAuth(...args),
  getAdminUser: (...args: unknown[]) => getAdminUser(...args),
  releaseDeviceAuthClaim: (...args: unknown[]) => releaseDeviceAuthClaim(...args),
  getDesktopDeviceAuth: vi.fn(),
  initDesktopDeviceAuth: vi.fn(),
  approveDesktopDeviceAuth: vi.fn(),
  cancelDesktopDeviceAuth: vi.fn(),
}));

import { pollDesktopDeviceAuth } from "./desktop-device-auth";

describe("pollDesktopDeviceAuth", () => {
  beforeEach(() => {
    ensureDesktopDeviceAuthFresh.mockReset();
    verifyDesktopDeviceSecret.mockReset();
    claimApprovedDeviceAuth.mockReset();
    createPat.mockReset();
    completeDesktopDeviceAuth.mockReset();
    getAdminUser.mockReset();
    releaseDeviceAuthClaim.mockReset();
  });

  it("issues a PAT after an approved device is polled", async () => {
    ensureDesktopDeviceAuthFresh.mockResolvedValue({
      deviceId: "dev-1",
      tenantId: "t1",
      deviceName: "MacBook",
      status: "approved",
      userId: "u1",
      deptId: "d1",
    });
    verifyDesktopDeviceSecret.mockReturnValue(true);
    claimApprovedDeviceAuth.mockResolvedValue({
      deviceId: "dev-1",
      tenantId: "t1",
      deviceName: "MacBook",
      status: "issuing",
      userId: "u1",
      deptId: "d1",
    });
    createPat.mockResolvedValue({ token: "agx-pat-issued", record: { id: 9 } });
    completeDesktopDeviceAuth.mockResolvedValue({ status: "consumed" });
    getAdminUser.mockResolvedValue({
      id: "u1",
      email: "a@example.invalid",
      displayName: "A",
      status: "active",
    });

    const result = await pollDesktopDeviceAuth({
      deviceId: "dev-1",
      deviceSecret: "secret",
    });

    expect(result).toMatchObject({
      status: "completed",
      token: "agx-pat-issued",
      tokenId: 9,
    });
    expect(createPat).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Desktop · MacBook",
        scopes: ["workspace:chat", "desktop:managed"],
      }),
    );
  });
});
