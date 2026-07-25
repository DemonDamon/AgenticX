import { describe, expect, it } from "vitest";
import { classifyModelHealthFailure } from "../electron/model-health";

describe("classifyModelHealthFailure", () => {
  it("marks MOMA Model Auth denials as unauthorized", () => {
    expect(
      classifyModelHealthFailure(
        401,
        "Request denied by Model Auth check. Invalid model.",
      ),
    ).toBe("unauthorized");
  });

  it("marks 401 Invalid model as unauthorized", () => {
    expect(classifyModelHealthFailure(401, "Invalid model")).toBe("unauthorized");
  });

  it("keeps invalid API key as generic error", () => {
    expect(
      classifyModelHealthFailure(401, "Incorrect API key provided"),
    ).toBe("error");
  });

  it("keeps 500 as generic error", () => {
    expect(classifyModelHealthFailure(500, "internal server error")).toBe("error");
  });

  it("keeps 404 empty body as generic error", () => {
    expect(classifyModelHealthFailure(404, "")).toBe("error");
  });

  it("marks Chinese unauthorized-model copy as unauthorized", () => {
    expect(classifyModelHealthFailure(403, "模型未授权，请联系管理员")).toBe(
      "unauthorized",
    );
  });
});
