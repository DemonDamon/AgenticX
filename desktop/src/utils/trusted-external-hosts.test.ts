import { afterEach, describe, expect, it } from "vitest";
import {
  addTrustedExternalHost,
  hostnameFromHttpUrl,
  isTrustedExternalHost,
  listTrustedExternalHosts,
  _resetTrustedExternalHostsForTests,
} from "./trusted-external-hosts";

afterEach(() => {
  _resetTrustedExternalHostsForTests();
});

describe("hostnameFromHttpUrl", () => {
  it("returns a lowercase host for http(s) URLs", () => {
    expect(hostnameFromHttpUrl("https://Drive.Tencent.com/home")).toBe("drive.tencent.com");
    expect(hostnameFromHttpUrl("http://example.com:8080/a")).toBe("example.com");
  });

  it("rejects non-http schemes", () => {
    expect(hostnameFromHttpUrl("javascript:alert(1)")).toBeNull();
    expect(hostnameFromHttpUrl("/relative")).toBeNull();
    expect(hostnameFromHttpUrl("")).toBeNull();
  });
});

describe("trusted external hosts", () => {
  it("trusts only the stored hostname", () => {
    addTrustedExternalHost("https://drive.tencent.com/home");
    expect(isTrustedExternalHost("https://drive.tencent.com/other")).toBe(true);
    expect(isTrustedExternalHost("https://tencent.com/home")).toBe(false);
    expect(listTrustedExternalHosts()).toEqual(["drive.tencent.com"]);
  });

  it("ignores invalid URLs when adding", () => {
    addTrustedExternalHost("not-a-url");
    expect(listTrustedExternalHosts()).toEqual([]);
  });
});
