import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigLoaderError, loadBrand, loadFeatures } from "../loaders";

describe("loadBrand", () => {
  const tempDirs: string[] = [];

  async function withTempFile(content: string, name = "brand.yaml") {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenticx-config-"));
    tempDirs.push(dir);
    const target = path.join(dir, name);
    await writeFile(target, content, "utf-8");
    return target;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
    delete process.env.NEXT_PUBLIC_BRAND_CONFIG;
    delete process.env.NEXT_PUBLIC_FEATURES_CONFIG;
  });

  it("loads valid yaml and applies default fallback fields", async () => {
    const brandPath = await withTempFile(`
brand:
  name: "Acme Enterprise"
  short_name: "Acme"
  primary_color: "220 90% 50%"
copyright:
  company: "Acme Inc"
  year: 2026
legal:
  privacy_url: "/privacy"
  terms_url: "/terms"
`);

    const result = await loadBrand(brandPath);

    expect(result.brand.name).toBe("Acme Enterprise");
    expect(result.brand.primary_color).toBe("220 90% 50%");
    expect(result.brand.secondary_color).toBeDefined();
    expect(result.compliance.enable_user_consent).toBe(true);
  });

  it("throws FILE_NOT_FOUND when file is missing", async () => {
    await expect(loadBrand("/tmp/does-not-exist-brand.yaml")).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });

  it("throws YAML_PARSE_ERROR for invalid yaml content", async () => {
    const brandPath = await withTempFile("brand: [");
    await expect(loadBrand(brandPath)).rejects.toMatchObject({
      code: "YAML_PARSE_ERROR",
    });
  });

  it("throws SCHEMA_INVALID when yaml value has wrong type", async () => {
    const brandPath = await withTempFile(`
brand:
  name: "Acme"
  short_name: "A"
  primary_color: 123
copyright:
  company: "Acme"
  year: 2026
legal:
  privacy_url: "/privacy"
  terms_url: "/terms"
`);

    await expect(loadBrand(brandPath)).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });
});

describe("loadFeatures", () => {
  const tempDirs: string[] = [];

  async function withTempFile(content: string, name = "features.yaml") {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agenticx-config-features-"));
    tempDirs.push(dir);
    const target = path.join(dir, name);
    await writeFile(target, content, "utf-8");
    return target;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
    delete process.env.NEXT_PUBLIC_FEATURES_CONFIG;
  });

  it("loads feature flags and merges defaults", async () => {
    const featurePath = await withTempFile(`
features:
  chat: true
  chat.web_search: false
  audit.query_ui: true
`);

    const result = await loadFeatures(featurePath);
    expect(result.chat).toBe(true);
    expect(result["chat.web_search"]).toBe(false);
    expect(result["audit.query_ui"]).toBe(true);
    expect(result["chat.multi_round"]).toBe(true);
  });
});

