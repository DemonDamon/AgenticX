import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readDesktopSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Tencent Meeting connector authorization fallback", () => {
  it("pins the verified Tencent Meeting CLI 1.0.15 package and platform binaries", () => {
    const main = readDesktopSource("electron/main.ts");

    expect(main).toContain('const TMEET_PACKAGE_VERSION = "1.0.15";');
    expect(main).toContain(
      '"https://registry.npmjs.org/@tencentcloud/tmeet/-/tmeet-1.0.15.tgz"',
    );
    expect(main).toContain(
      '"lMvcaNgEujhYk7RNakghdyjk5VukEeHrJOlpTenNhyiNuBcCEa9XtW8pYMQQDcxltAQpT9omGogkaXXAakN10w=="',
    );
    const expectedBinaryHashes = [
      '"tmeet-Linux-ARM64": "789cf1643957c5e6e4cccfcc6e60fdb237fb2c94222316a3a4c2dd05ebdd8bd9"',
      '"tmeet-Linux-x86_64": "ef76a60fe2dc630b3b87c1e2e8c0f46b5e065c69dc9441f67d0bdb916116084f"',
      '"tmeet-Windows-x86_64.exe": "755ca8d8328a9217b2e3c681b2bf9204b4a725079a1a0339e62eea0c984348e8"',
      '"tmeet-macOS-AppleSilicon": "f245226550cda8e1ea8b6e6bafbead2fb91e6e823b52905f5bb1cae485ec3914"',
      '"tmeet-macOS-Intel": "f0f954345fca981f8834f2e6d7fa2329e87960ce068310dcabbdd42642b3e71a"',
    ];
    for (const expectedHash of expectedBinaryHashes) expect(main).toContain(expectedHash);
  });

  it("keeps the CLI login alive when the system browser cannot be opened", () => {
    const main = readDesktopSource("electron/main.ts");
    const start = main.indexOf("function startTmeetLogin()");
    const end = main.indexOf("const GH_CLI_VERSION", start);
    const loginFlow = main.slice(start, end);
    const openStart = loginFlow.indexOf("void shell");
    const openEnd = loginFlow.indexOf("\n      }\n    };", openStart);
    const browserOpenFlow = loginFlow.slice(openStart, openEnd);

    expect(loginFlow).toContain(
      'sendTmeetProgress("opening_browser", { authorizationUrl });',
    );
    expect(browserOpenFlow).toContain(
      'sendTmeetProgress("waiting", { authorizationUrl })',
    );
    expect(browserOpenFlow).toContain("browserOpenFailed: true");
    expect(browserOpenFlow).not.toContain("finish(");
  });

  it("exposes only optional fallback metadata through the progress bridge", () => {
    const main = readDesktopSource("electron/main.ts");
    const preload = readDesktopSource("electron/preload.ts");
    const globalTypes = readDesktopSource("src/global.d.ts");

    expect(main).toContain("authorizationUrl?: string;");
    expect(main).toContain("browserOpenFailed?: boolean;");
    expect(preload).toContain("authorizationUrl?: string;");
    expect(preload).toContain("browserOpenFailed?: boolean;");
    expect(globalTypes).toContain("authorizationUrl?: string;");
    expect(globalTypes).toContain("browserOpenFailed?: boolean;");
  });

  it("reuses one QR, copy, and reopen fallback in both renderer entry points", () => {
    const fallback = readDesktopSource(
      "src/components/connectors/TencentMeetingAuthFallback.tsx",
    );
    const settings = readDesktopSource(
      "src/components/settings/connectors/ConnectorsTab.tsx",
    );
    const composerMenu = readDesktopSource(
      "src/components/connectors/ConnectorsMenuButton.tsx",
    );

    expect(fallback).toContain("QRCode.toDataURL(authorizationUrl");
    expect(fallback).toContain("window.agenticxDesktop.openExternal(authorizationUrl)");
    expect(fallback).toContain("navigator.clipboard.writeText(authorizationUrl)");
    expect(settings).toContain("<TencentMeetingAuthFallback");
    expect(composerMenu).toContain("<TencentMeetingAuthFallback");
    expect(composerMenu).toContain("nativeConnectorTmeetCancel()");
  });
});
