import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listChromeCookieProfiles } from "../electron/chrome-cookie-import";

describe("listChromeCookieProfiles", () => {
  it("reads display names from Local State and skips guest/system", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "near-chrome-profiles-"));
    fs.writeFileSync(
      path.join(root, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "工作" },
            "Profile 1": { name: "个人" },
          },
        },
      }),
    );
    fs.mkdirSync(path.join(root, "Default", "Network"), { recursive: true });
    fs.writeFileSync(path.join(root, "Default", "Network", "Cookies"), "");
    fs.mkdirSync(path.join(root, "Profile 1"), { recursive: true });
    fs.writeFileSync(path.join(root, "Profile 1", "Cookies"), "");
    fs.mkdirSync(path.join(root, "Guest Profile", "Network"), { recursive: true });
    fs.writeFileSync(path.join(root, "Guest Profile", "Network", "Cookies"), "");

    const profiles = listChromeCookieProfiles(root);
    expect(profiles.map((p) => ({ id: p.id, name: p.name }))).toEqual([
      { id: "Default", name: "工作" },
      { id: "Profile 1", name: "个人" },
    ]);
  });
});
