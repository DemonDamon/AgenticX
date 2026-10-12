import { describe, expect, it } from "vitest";
import { shouldHoverPrefetchAdminNav } from "../admin-nav-prefetch";

describe("shouldHoverPrefetchAdminNav", () => {
  it("never prefetches on hover — webpack compile would freeze the server", () => {
    expect(
      shouldHoverPrefetchAdminNav({
        href: "/admin/channels",
        pathname: "/admin/models",
        navPrefetchEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldHoverPrefetchAdminNav({
        href: "/admin/models",
        pathname: "/dashboard",
        navPrefetchEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldHoverPrefetchAdminNav({
        href: "/portal-logs",
        pathname: "/admin/models",
        navPrefetchEnabled: false,
      }),
    ).toBe(false);
  });
});
