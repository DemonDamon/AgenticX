import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stableStringify } from "../manifest-diff";
import { formToManifest, manifestToForm, ManifestFormError } from "../manifest-form";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../tests/fixtures/managed_agents/manifest_cases.json",
);

type ManifestCase = { name: string; normalized: Record<string, unknown> | null };

function normalized(name: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: ManifestCase[] };
  const found = raw.cases.find((item) => item.name === name);
  if (!found?.normalized) throw new Error(`missing fixture ${name}`);
  return found.normalized;
}

describe("manifest form", () => {
  it("manifestToForm then formToManifest round-trips a full manifest", () => {
    const manifest = normalized("full_ok");
    const out = formToManifest(manifestToForm(manifest), manifest);
    expect(stableStringify(out)).toBe(stableStringify(manifest));
  });

  it("preserves unknown metadata keys including legacy_capability_ids", () => {
    const manifest = normalized("full_ok");
    manifest.metadata = {
      ...(manifest.metadata as Record<string, unknown>),
      legacy_capability_ids: ["skill:01ARZ3NDEKTSV4RRFFQ69G5FAV"],
      extra_flag: true,
    };
    const out = formToManifest(manifestToForm(manifest), manifest);
    expect(out.metadata).toMatchObject({
      legacy_capability_ids: ["skill:01ARZ3NDEKTSV4RRFFQ69G5FAV"],
      extra_flag: true,
      welcome_message: "hi",
    });
  });

  it("inherit policy omits the policy key", () => {
    const base = normalized("minimal_ok");
    const form = manifestToForm(base);
    form.builtin = {
      present: true,
      defaultPolicy: "always_allow",
      configs: [{ name: "bash_exec", policy: "inherit", enabled: true }],
    };
    const out = formToManifest(form, base);
    const tool = (out.tools as Array<{ configs: Array<Record<string, unknown>> }>)[0];
    const config = tool?.configs[0];
    expect(config).toEqual({ name: "bash_exec" });
    expect(config).not.toHaveProperty("policy");
    expect(config).not.toHaveProperty("enabled");
  });

  it("invalid custom tool schema throws ManifestFormError", () => {
    const base = normalized("minimal_ok");
    const form = manifestToForm(base);
    form.customTools = [{ name: "lookup", description: "d", inputSchemaText: "{" }];
    expect(() => formToManifest(form, base)).toThrow(ManifestFormError);
    expect(() => formToManifest(form, base)).toThrow(/输入参数不是合法 JSON/);
  });

  it("empty maxSessionTokens becomes null", () => {
    const base = normalized("full_ok");
    const form = manifestToForm(base);
    form.maxSessionTokens = "";
    const out = formToManifest(form, base);
    expect((out.runtime as { max_session_tokens: unknown }).max_session_tokens).toBeNull();
  });

  it("removes welcome_message when blank", () => {
    const base = normalized("full_ok");
    const form = manifestToForm(base);
    form.welcomeMessage = "";
    const out = formToManifest(form, base);
    expect(out.metadata).not.toHaveProperty("welcome_message");
  });

  it("does not import @agenticx/core-api", () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../manifest-form.ts"), "utf8");
    expect(source).not.toContain("@agenticx/core-api");
  });
});
