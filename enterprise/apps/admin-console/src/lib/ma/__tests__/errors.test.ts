import { describe, expect, it, vi } from "vitest";

import { maErrorFromException } from "../errors";

function named(name: string, message: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { name, ...extra });
}

const cases: Array<{ name: string; status: number; code: string; extra?: Record<string, unknown> }> = [
  { name: "AgentValidationError", status: 400, code: "invalid_request" },
  { name: "MaEnvironmentValidationError", status: 400, code: "invalid_request" },
  { name: "AgentNotFoundError", status: 404, code: "agent_not_found" },
  { name: "AgentVersionNotFoundError", status: 404, code: "agent_version_not_found" },
  { name: "MaEnvironmentNotFoundError", status: 404, code: "environment_not_found" },
  { name: "AgentManifestInvalidError", status: 400, code: "manifest_invalid", extra: { errors: ["manifest.model: is required"] } },
  { name: "AgentVersionConflictError", status: 409, code: "agent_version_conflict", extra: { currentLatestVersion: 3 } },
  { name: "AgentSlugConflictError", status: 409, code: "agent_slug_conflict" },
  { name: "MaEnvironmentNameConflictError", status: 409, code: "environment_name_conflict" },
  { name: "MaEnvironmentInUseError", status: 409, code: "environment_in_use" },
];

describe("ma error mapping", () => {
  it("maps iam-core errors by name", async () => {
    expect(cases).toHaveLength(10);
    for (const entry of cases) {
      const response = maErrorFromException(named(entry.name, `raw ${entry.name}`, entry.extra));
      expect(response.status, entry.name).toBe(entry.status);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code, entry.name).toBe(entry.code);
    }
  });

  it("manifest_invalid details.errors are passed through", async () => {
    const response = maErrorFromException(
      named("AgentManifestInvalidError", "定义校验未通过", { errors: ["manifest.model: is required"] }),
    );
    const body = (await response.json()) as { error: { details?: { errors?: string[] } } };
    expect(body.error.details?.errors).toEqual(["manifest.model: is required"]);
  });

  it("agent_version_conflict details.current_latest_version", async () => {
    const response = maErrorFromException(named("AgentVersionConflictError", "changed", { currentLatestVersion: 3 }));
    const body = (await response.json()) as { error: { details?: { current_latest_version?: number } } };
    expect(body.error.details?.current_latest_version).toBe(3);
  });

  it("unknown error returns 500 internal_error without leaking message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = maErrorFromException(new Error("database password leaked"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("internal error");
    spy.mockRestore();
  });
});
