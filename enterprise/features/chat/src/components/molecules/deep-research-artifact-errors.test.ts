import { describe, expect, it } from "vitest";
import {
  artifactRequestErrorMessage,
  normalizeArtifactRequestError,
  readArtifactErrorCode,
} from "./deep-research-artifact-errors";

describe("artifactRequestErrorMessage", () => {
  it("maps 401 to expired-login copy instead of the raw status", () => {
    const msg = artifactRequestErrorMessage(401, "list");
    expect(msg).toBe("登录状态已失效，请重新登录后再试");
    expect(msg).not.toMatch(/401/);
  });

  it("separates forced password change from a permission denial on 403", () => {
    expect(artifactRequestErrorMessage(403, "preview", "40302")).toBe(
      "需要先修改登录密码才能访问文件",
    );
    expect(artifactRequestErrorMessage(403, "preview")).toBe("没有访问该文件的权限");
  });

  it("scopes 404 copy to session vs file", () => {
    expect(artifactRequestErrorMessage(404, "list")).toBe("该会话不存在或已被删除");
    expect(artifactRequestErrorMessage(404, "preview")).toBe("文件不存在或已被删除");
    expect(artifactRequestErrorMessage(404, "download")).toBe("文件不存在或已被删除");
  });

  it("maps throttling and server faults", () => {
    expect(artifactRequestErrorMessage(429, "list")).toBe("请求过于频繁，请稍后重试");
    expect(artifactRequestErrorMessage(500, "preview")).toBe("服务暂时不可用，请稍后重试");
    expect(artifactRequestErrorMessage(503, "download")).toBe("服务暂时不可用，请稍后重试");
  });

  it("falls back per scope for unmapped statuses without leaking the code", () => {
    expect(artifactRequestErrorMessage(418, "list")).toBe("文件列表加载失败，请稍后重试");
    expect(artifactRequestErrorMessage(418, "preview")).toBe("预览加载失败，请稍后重试");
    expect(artifactRequestErrorMessage(418, "download")).toBe("文件下载失败，请稍后重试");
    expect(artifactRequestErrorMessage(418, "list")).not.toMatch(/418/);
  });
});

describe("readArtifactErrorCode", () => {
  it("reads both the nested and flat error code shapes", async () => {
    await expect(
      readArtifactErrorCode({ json: async () => ({ error: { code: "40101" } }) }),
    ).resolves.toBe("40101");
    await expect(
      readArtifactErrorCode({ json: async () => ({ code: "40302" }) }),
    ).resolves.toBe("40302");
  });

  it("returns undefined for empty or unparsable bodies", async () => {
    await expect(
      readArtifactErrorCode({
        json: async () => {
          throw new Error("Unexpected end of JSON input");
        },
      }),
    ).resolves.toBeUndefined();
    await expect(readArtifactErrorCode({ json: async () => null })).resolves.toBeUndefined();
  });
});

describe("normalizeArtifactRequestError", () => {
  it("maps browser transport failures to offline copy", () => {
    for (const raw of ["Failed to fetch", "Load failed", "NetworkError when …", "fetch failed"]) {
      expect(normalizeArtifactRequestError(new Error(raw), "preview")).toBe(
        "无法连接门户服务，请检查网络后重试",
      );
    }
  });

  it("never lets a bare status line reach the panel", () => {
    expect(normalizeArtifactRequestError(new Error("HTTP 401"), "list")).toBe(
      "文件列表加载失败，请稍后重试",
    );
    expect(normalizeArtifactRequestError(new Error("HTTP 500"), "preview")).toBe(
      "预览加载失败，请稍后重试",
    );
  });

  it("passes through already-normalized copy and handles non-errors", () => {
    const copy = artifactRequestErrorMessage(401, "list");
    expect(normalizeArtifactRequestError(new Error(copy), "list")).toBe(copy);
    expect(normalizeArtifactRequestError(undefined, "download")).toBe("文件下载失败，请稍后重试");
    expect(normalizeArtifactRequestError(new Error("   "), "list")).toBe(
      "文件列表加载失败，请稍后重试",
    );
  });
});
