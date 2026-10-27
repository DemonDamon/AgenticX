import { describe, expect, it } from "vitest";

import {
  MaEnvironmentValidationError,
  normalizeEnvironmentConfig,
  validateEnvironmentInput,
} from "../ma-environments";

describe("environment config", () => {
  it("normalizes cloud config with defaults", () => {
    expect(normalizeEnvironmentConfig("cloud", { type: "cloud" })).toEqual({
      type: "cloud",
      sandbox_backend: "docker",
      image: null,
      egress_allow_domains: [],
      idle_ttl_seconds: 3600,
    });
  });

  it("lowercases and dedupes egress domains", () => {
    const config = normalizeEnvironmentConfig("cloud", {
      type: "cloud",
      egress_allow_domains: ["Example.COM", "example.com", " *.API.Example.com "],
    });
    if (config.type !== "cloud") throw new Error("expected cloud");
    expect(config.egress_allow_domains).toEqual(["example.com", "*.api.example.com"]);
  });

  it("rejects unknown config keys", () => {
    expect(() => normalizeEnvironmentConfig("cloud", { type: "cloud", foo: 1 })).toThrow(
      "环境配置包含未知字段：foo",
    );
  });

  it("rejects config type mismatch", () => {
    expect(() => normalizeEnvironmentConfig("cloud", { type: "desktop_worker" })).toThrow(
      "环境配置类型与环境类型不一致",
    );
  });

  it("rejects idle ttl out of range", () => {
    expect(() => normalizeEnvironmentConfig("cloud", { type: "cloud", idle_ttl_seconds: 10 })).toThrow(
      "空闲回收时间须为 60–86400 秒之间的整数",
    );
  });

  it("normalizes desktop_worker worker_keys", () => {
    expect(
      normalizeEnvironmentConfig("desktop_worker", { type: "desktop_worker", worker_keys: [" a ", "a", "b"] }),
    ).toEqual({ type: "desktop_worker", worker_keys: ["a", "b"] });
  });

  it("rejects illegal environment name", () => {
    expect(() => validateEnvironmentInput({ name: "bad/name", type: "cloud" })).toThrow(MaEnvironmentValidationError);
  });

  it("validateEnvironmentInput accepts Chinese names", () => {
    expect(() => validateEnvironmentInput({ name: "报告环境", type: "cloud" })).not.toThrow();
  });
});
