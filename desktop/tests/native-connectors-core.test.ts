import { describe, expect, it } from "vitest";

import {
  buildTapdMcpEntry,
  assertManagedSkillDirectory,
  extractAuthorizationUrl,
  extractFeishuDeviceFlow,
  extractGithubDeviceCode,
  extractGithubDeviceUrl,
  extractLastJsonObject,
  isTapdValidationSuccess,
  isWecomProbeSuccessful,
  mergeTapdMcpDocument,
  nativeConnectorAvailability,
  parseFeishuAuthStatus,
  parseGithubAuthStatus,
  parseTmeetAuthStatus,
  readBodyWithLimit,
  resolveConnectedConnectorIds,
  wecomNpmPlatformPackage,
} from "../electron/native-connectors-core";

describe("parseTmeetAuthStatus", () => {
  it("recognizes an authenticated CLI status", () => {
    expect(parseTmeetAuthStatus("Logged in\n  UserName: Damon")).toEqual({
      connected: true,
      label: "已连接",
    });
  });

  it("recognizes an unauthenticated CLI status", () => {
    expect(parseTmeetAuthStatus("Not logged in")).toEqual({
      connected: false,
      label: "可用",
    });
  });

  it("treats unknown output as an error", () => {
    expect(parseTmeetAuthStatus("unexpected output")).toEqual({
      connected: false,
      label: "状态异常",
      error: "无法识别腾讯会议登录状态",
    });
  });
});

describe("extractAuthorizationUrl", () => {
  it("extracts the official Tencent Meeting authorization URL", () => {
    expect(
      extractAuthorizationUrl(
        "请打开 https://meeting.tencent.com/qrcode-login.html?slim=1&redirect_link=abc 完成授权",
      ),
    ).toBe("https://meeting.tencent.com/qrcode-login.html?slim=1&redirect_link=abc");
  });

  it("rejects non-Tencent authorization URLs", () => {
    expect(extractAuthorizationUrl("https://evil.example/oauth")).toBeNull();
  });
});

describe("buildTapdMcpEntry", () => {
  it("builds a stdio MCP entry using Electron as Node", () => {
    expect(buildTapdMcpEntry("/Applications/Near", "/app/tapd/dist/index.js", "secret-token")).toEqual({
      command: "/Applications/Near",
      args: ["/app/tapd/dist/index.js"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        TAPD_ACCESS_TOKEN: "secret-token",
        TAPD_API_BASE_URL: "https://api.tapd.cn",
      },
    });
  });
});

describe("isTapdValidationSuccess", () => {
  it("accepts a successful TAPD API envelope", () => {
    expect(isTapdValidationSuccess({ status: 1, data: [] })).toBe(true);
  });

  it("rejects error and malformed envelopes", () => {
    expect(isTapdValidationSuccess({ status: 0, info: "invalid token" })).toBe(false);
    expect(isTapdValidationSuccess(null)).toBe(false);
  });
});

describe("mergeTapdMcpDocument", () => {
  const entry = buildTapdMcpEntry("/Near", "/tapd/index.js", "new-token");

  it("creates the first mcpServers document", () => {
    expect(mergeTapdMcpDocument({}, entry)).toEqual({
      mcpServers: { tapd: entry },
    });
  });

  it("preserves unrelated servers and replaces TAPD atomically", () => {
    const github = { command: "github-mcp" };
    const result = mergeTapdMcpDocument(
      { other: true, mcpServers: { github, tapd: { command: "old" } } },
      entry,
    );
    expect(result).toEqual({
      other: true,
      mcpServers: { github, tapd: entry },
    });
  });
});

describe("assertManagedSkillDirectory", () => {
  it("allows new and already managed directories", () => {
    expect(() => assertManagedSkillDirectory(false, false)).not.toThrow();
    expect(() => assertManagedSkillDirectory(true, true)).not.toThrow();
  });

  it("refuses to take ownership of a user directory", () => {
    expect(() => assertManagedSkillDirectory(true, false)).toThrow(
      "检测到同名用户技能目录",
    );
  });
});

describe("readBodyWithLimit", () => {
  it("collects a response body under the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    await expect(readBodyWithLimit(body, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("cancels a response body as soon as it crosses the limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBodyWithLimit(body, 3)).rejects.toThrow("下载内容超过安全限制");
    expect(cancelled).toBe(true);
  });
});

describe("resolveConnectedConnectorIds", () => {
  it("combines native and MCP-backed connector states without duplicates", () => {
    expect(
      resolveConnectedConnectorIds(true, [
        { name: "tapd", connected: true },
        { name: "github", connected: true },
        { name: "tapd", connected: true },
      ]),
    ).toEqual(["tencent-meeting", "tapd"]);
  });

  it("returns no connector for unrelated MCP services", () => {
    expect(resolveConnectedConnectorIds(false, [{ name: "github", connected: true }])).toEqual([]);
  });

  it("includes github when the native github connector is connected", () => {
    expect(resolveConnectedConnectorIds(false, [], true)).toEqual(["github"]);
  });

  it("includes feishu when the native feishu connector is connected", () => {
    expect(resolveConnectedConnectorIds(false, [], false, true)).toEqual(["feishu"]);
  });

  it("includes github and feishu together when both are connected", () => {
    expect(resolveConnectedConnectorIds(false, [], true, true)).toEqual(["github", "feishu"]);
  });

  it("includes wecom when the native wecom connector is connected", () => {
    expect(resolveConnectedConnectorIds(false, [], false, false, true)).toEqual(["wecom"]);
  });
});

describe("nativeConnectorAvailability", () => {
  it("marks only implemented MVP connectors as available", () => {
    expect(nativeConnectorAvailability("tencent-meeting")).toBe("available");
    expect(nativeConnectorAvailability("tapd")).toBe("available");
    expect(nativeConnectorAvailability("github")).toBe("available");
    expect(nativeConnectorAvailability("feishu")).toBe("available");
    expect(nativeConnectorAvailability("wecom")).toBe("available");
    expect(nativeConnectorAvailability("notion")).toBe("unavailable");
  });
});

describe("wecomNpmPlatformPackage", () => {
  it("maps supported platforms to npm binary packages", () => {
    expect(wecomNpmPlatformPackage("darwin", "arm64")).toBe("@wecom/cli-darwin-arm64");
    expect(wecomNpmPlatformPackage("win32", "x64")).toBe("@wecom/cli-win32-x64");
  });

  it("returns null for unsupported platforms like win32-arm64", () => {
    expect(wecomNpmPlatformPackage("win32", "arm64")).toBeNull();
  });
});

describe("isWecomProbeSuccessful", () => {
  it("accepts non-empty JSON without an error field", () => {
    expect(isWecomProbeSuccessful('{"userlist":[]}')).toBe(true);
  });

  it("rejects JSON with an error field or empty output", () => {
    expect(isWecomProbeSuccessful('{"error":"invalid credential"}')).toBe(false);
    expect(isWecomProbeSuccessful("")).toBe(false);
  });
});

describe("parseGithubAuthStatus", () => {
  it("recognizes an authenticated CLI status", () => {
    expect(
      parseGithubAuthStatus("✓ Logged in to github.com account DemonDamon (keyring)"),
    ).toEqual({
      connected: true,
      account: "DemonDamon",
      label: "已连接",
    });
  });

  it("recognizes an unauthenticated CLI status", () => {
    expect(parseGithubAuthStatus("You are not logged into any GitHub hosts.")).toEqual({
      connected: false,
      label: "可用",
    });
  });

  it("treats unknown output as an error", () => {
    expect(parseGithubAuthStatus("garbage")).toEqual({
      connected: false,
      label: "状态异常",
      error: "无法识别 GitHub 登录状态",
    });
  });
});

describe("extractGithubDeviceCode", () => {
  it("extracts a one-time device code", () => {
    expect(extractGithubDeviceCode("! First copy your one-time code: 6C41-A1BC")).toBe("6C41-A1BC");
  });
});

describe("extractGithubDeviceUrl", () => {
  it("extracts the official GitHub device verification URL", () => {
    expect(extractGithubDeviceUrl("Open https://github.com/login/device in your browser")).toBe(
      "https://github.com/login/device",
    );
  });

  it("rejects non-GitHub device URLs", () => {
    expect(extractGithubDeviceUrl("https://evil.com/login/device")).toBeNull();
  });
});

describe("extractLastJsonObject", () => {
  it("extracts the last JSON object after log prefixes", () => {
    expect(
      extractLastJsonObject('INFO booting\n{"identity":"user","userName":"李四","appId":"cli_y"}'),
    ).toEqual({ identity: "user", userName: "李四", appId: "cli_y" });
  });
});

describe("parseFeishuAuthStatus", () => {
  it("recognizes an authenticated user identity", () => {
    expect(
      parseFeishuAuthStatus(
        '{"identity":"user","userName":"张三","appId":"cli_x","tokenStatus":"valid"}',
      ),
    ).toEqual({
      configured: true,
      connected: true,
      account: "张三",
      label: "已连接",
    });
  });

  it("recognizes nested identities.user from current lark-cli auth status", () => {
    expect(
      parseFeishuAuthStatus(
        JSON.stringify({
          appId: "cli_aac4d20e6e78dcb1",
          brand: "feishu",
          identity: "user",
          identities: {
            bot: { status: "ready", available: true },
            user: {
              status: "ready",
              available: true,
              userName: "库洛洛",
              tokenStatus: "valid",
            },
          },
        }),
      ),
    ).toEqual({
      configured: true,
      connected: true,
      account: "库洛洛",
      label: "已连接",
    });
  });

  it("recognizes configured but not logged-in bot identity", () => {
    expect(
      parseFeishuAuthStatus(
        '{"identity":"bot","appId":"cli_x","note":"No user logged in..."}',
      ),
    ).toEqual({
      configured: true,
      connected: false,
      label: "待登录",
    });
  });

  it("treats garbage output as unconfigured", () => {
    expect(parseFeishuAuthStatus("garbage no json")).toEqual({
      configured: false,
      connected: false,
      label: "可用",
    });
  });

  it("skips log prefixes before the JSON status", () => {
    expect(
      parseFeishuAuthStatus(
        'INFO booting\n{"identity":"user","userName":"李四","appId":"cli_y"}',
      ),
    ).toEqual({
      configured: true,
      connected: true,
      account: "李四",
      label: "已连接",
    });
  });
});

describe("extractFeishuDeviceFlow", () => {
  it("extracts verification URL and device code from auth login --no-wait JSON", () => {
    expect(
      extractFeishuDeviceFlow(
        '{"verification_url":"https://accounts.feishu.cn/verify?user_code=ABCD-1234","device_code":"dc_1","expires_in":1800}',
      ),
    ).toEqual({
      verificationUrl: "https://accounts.feishu.cn/verify?user_code=ABCD-1234",
      deviceCode: "dc_1",
    });
  });

  it("rejects non-Feishu verification hosts", () => {
    expect(
      extractFeishuDeviceFlow('{"verification_url":"https://evil.com/verify?user_code=x"}'),
    ).toBeNull();
  });

  it("returns null when config init success has no verification_url", () => {
    expect(extractFeishuDeviceFlow('{"appId":"cli_x","brand":"feishu"}')).toBeNull();
  });
});
