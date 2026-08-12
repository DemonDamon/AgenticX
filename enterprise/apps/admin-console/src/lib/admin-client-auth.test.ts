import { describe, expect, it } from "vitest";
import { readAdminJsonResponse } from "./admin-client-auth";

describe("readAdminJsonResponse", () => {
  it("parses a valid JSON response", async () => {
    const response = new Response('{"code":"00000"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(readAdminJsonResponse<{ code: string }>(response)).resolves.toEqual({
      code: "00000",
    });
  });

  it("turns an empty response into a readable error", async () => {
    const response = new Response("", { status: 502 });

    await expect(
      readAdminJsonResponse(response, "批量导入失败"),
    ).rejects.toThrow("批量导入失败：服务未返回结果（HTTP 502）");
  });

  it("does not expose the browser JSON parser error for a non-JSON response", async () => {
    const response = new Response("<html>upstream error</html>", { status: 500 });

    await expect(
      readAdminJsonResponse(response, "批量导入失败"),
    ).rejects.toThrow("批量导入失败：服务返回格式异常（HTTP 500）");
  });
});
