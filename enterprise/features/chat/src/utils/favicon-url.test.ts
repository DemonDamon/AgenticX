import { describe, expect, it } from "vitest";
import {
  hostVariants,
  resolveFaviconCandidates,
  hostnameFromUrlOrDomain,
} from "./favicon-url";

describe("favicon-url", () => {
  it("extracts host from url", () => {
    expect(hostnameFromUrlOrDomain("https://www.zhihu.com/question/1")).toBe("zhihu.com");
  });

  it("builds parent variants like Near Desktop", () => {
    expect(hostVariants("zhuanlan.zhihu.com")).toEqual(["zhuanlan.zhihu.com", "zhihu.com"]);
  });

  it("includes BFF then DDG/Yandex/Google for each variant", () => {
    const list = resolveFaviconCandidates("zhuanlan.zhihu.com");
    expect(list[0]).toContain("/api/web-search/favicon?host=zhuanlan.zhihu.com");
    expect(list.some((u) => u.includes("icons.duckduckgo.com") && u.includes("zhihu.com"))).toBe(
      true,
    );
    expect(list.some((u) => u.includes("google.com/s2/favicons"))).toBe(true);
    expect(list.some((u) => u.includes("host=zhihu.com"))).toBe(true);
  });
});
