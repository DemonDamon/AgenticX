import { describe, expect, it } from "vitest";

import { decodePercentEncodedLocalPath, pickLocalFsPathCandidate } from "./local-fs-path";
import { resolveRelativeAssetPath } from "./workspace-file-path";

const REAL_SESSION_SVG =
  "/Users/damon/.agenticx/taskspaces/c8d28da7-9a3f-4dec-9475-f26a4ab51cdf/default/推演报告/推文/img/01-循环融资链条.svg";

const ENCODED_SESSION_SVG = encodeURI(REAL_SESSION_SVG);

describe("decodePercentEncodedLocalPath", () => {
  it("decodes markdown-encoded Chinese directories and filename (session regression)", () => {
    expect(decodePercentEncodedLocalPath(ENCODED_SESSION_SVG)).toBe(REAL_SESSION_SVG);
  });

  it("keeps already-decoded Chinese paths unchanged", () => {
    expect(decodePercentEncodedLocalPath(REAL_SESSION_SVG)).toBe(REAL_SESSION_SVG);
  });

  it("does not turn encoded slashes into path separators", () => {
    expect(decodePercentEncodedLocalPath("/tmp/a%2F..%2Fsecret.svg")).toBe("/tmp/a%2F..%2Fsecret.svg");
  });

  it("does not decode an encoded parent-directory segment", () => {
    expect(decodePercentEncodedLocalPath("/tmp/%2e%2e/secret.svg")).toBe("/tmp/%2e%2e/secret.svg");
  });

  it("decodes space and hash once", () => {
    expect(decodePercentEncodedLocalPath("/tmp/foo%20bar%23baz.svg")).toBe("/tmp/foo bar#baz.svg");
  });

  it("leaves malformed percent escapes unchanged", () => {
    expect(decodePercentEncodedLocalPath("/tmp/a%zz.svg")).toBe("/tmp/a%zz.svg");
  });

  it("does not decode remote or bundled urls", () => {
    expect(decodePercentEncodedLocalPath("https://example.com/%E4%B8%AD.png")).toBe(
      "https://example.com/%E4%B8%AD.png",
    );
    expect(decodePercentEncodedLocalPath("/assets/logo.svg")).toBe("/assets/logo.svg");
  });

  it("decodes file:// URLs", () => {
    expect(decodePercentEncodedLocalPath(`file://${ENCODED_SESSION_SVG}`)).toBe(`file://${REAL_SESSION_SVG}`);
  });

  it("decodes Windows drive paths", () => {
    expect(decodePercentEncodedLocalPath("C:/Users/%E6%8E%A8%E6%BC%94/a.svg")).toBe("C:/Users/推演/a.svg");
  });
});

describe("pickLocalFsPathCandidate", () => {
  it("prefers a literal percent-encoded filename when that file exists", () => {
    const encoded = "/tmp/01-%E5%BE%AA.svg";
    expect(pickLocalFsPathCandidate(encoded, (p) => p === encoded)).toBe(encoded);
  });

  it("uses decoded path when only the real Chinese file exists", () => {
    expect(pickLocalFsPathCandidate(ENCODED_SESSION_SVG, (p) => p === REAL_SESSION_SVG)).toBe(
      REAL_SESSION_SVG,
    );
  });

  it("falls back to decoded path when neither exists so errors stay readable", () => {
    expect(pickLocalFsPathCandidate(ENCODED_SESSION_SVG, () => false)).toBe(REAL_SESSION_SVG);
  });
});

describe("resolveRelativeAssetPath + percent-encoded markdown src", () => {
  it("joins encoded relative SVG names onto a Chinese host directory", () => {
    const host =
      "/Users/damon/.agenticx/taskspaces/c8d28da7-9a3f-4dec-9475-f26a4ab51cdf/default/推演报告/推文/两万亿的半成品.md";
    expect(resolveRelativeAssetPath(host, "img/01-%E5%BE%AA%E7%8E%AF%E8%9E%8D%E8%B5%84%E9%93%BE%E6%9D%A1.svg")).toBe(
      "/Users/damon/.agenticx/taskspaces/c8d28da7-9a3f-4dec-9475-f26a4ab51cdf/default/推演报告/推文/img/01-循环融资链条.svg",
    );
  });
});
