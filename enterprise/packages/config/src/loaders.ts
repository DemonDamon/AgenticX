import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  BrandConfigSchema,
  BrandYamlSchema,
  DEFAULT_BRAND_CONFIG,
  DEFAULT_FEATURE_FLAGS,
  FeatureFlags,
  FeatureYamlSchema,
} from "./schemas";

const THEME_DEFAULT_MANIFEST = "plugins/theme-default/manifest.yaml";

type LoaderErrorCode = "MISSING_PATH" | "FILE_NOT_FOUND" | "YAML_PARSE_ERROR" | "SCHEMA_INVALID";

export class ConfigLoaderError extends Error {
  public readonly code: LoaderErrorCode;

  public constructor(code: LoaderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ConfigLoaderError";
  }
}

function resolvePath(explicitPath: string | undefined, envKey: string): string {
  const value = explicitPath?.trim() || process.env[envKey]?.trim();
  if (!value) {
    throw new ConfigLoaderError("MISSING_PATH", `Missing config path. Provide argument or env ${envKey}.`);
  }
  return value;
}

async function readYamlObject(configPath: string): Promise<unknown> {
  try {
    await access(configPath);
  } catch {
    throw new ConfigLoaderError("FILE_NOT_FOUND", `Config file does not exist: ${configPath}`);
  }

  try {
    const content = await readFile(configPath, "utf-8");
    return YAML.parse(content);
  } catch (error) {
    throw new ConfigLoaderError(
      "YAML_PARSE_ERROR",
      `Failed to parse YAML at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function assertThemePackExists(configPath: string): Promise<void> {
  const enterpriseRoot = path.resolve(path.dirname(configPath), "..", "..", "..");
  const manifestPath = path.join(enterpriseRoot, THEME_DEFAULT_MANIFEST);
  try {
    await access(manifestPath);
  } catch {
    // theme-default 不存在时也保持可运行，继续使用内置默认值
  }
}

export async function loadBrand(yamlPath?: string) {
  const configPath = resolvePath(yamlPath, "NEXT_PUBLIC_BRAND_CONFIG");
  await assertThemePackExists(configPath);

  const data = await readYamlObject(configPath);
  const parsed = BrandYamlSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigLoaderError("SCHEMA_INVALID", `Invalid brand schema: ${parsed.error.message}`);
  }

  const merged = {
    brand: { ...DEFAULT_BRAND_CONFIG.brand, ...(parsed.data.brand ?? {}) },
    copyright: { ...DEFAULT_BRAND_CONFIG.copyright, ...(parsed.data.copyright ?? {}) },
    legal: { ...DEFAULT_BRAND_CONFIG.legal, ...(parsed.data.legal ?? {}) },
    compliance: { ...DEFAULT_BRAND_CONFIG.compliance, ...(parsed.data.compliance ?? {}) },
  };

  return BrandConfigSchema.parse(merged);
}

export async function loadFeatures(yamlPath?: string): Promise<FeatureFlags> {
  const configPath = resolvePath(yamlPath, "NEXT_PUBLIC_FEATURES_CONFIG");
  const data = await readYamlObject(configPath);
  const parsed = FeatureYamlSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigLoaderError("SCHEMA_INVALID", `Invalid features schema: ${parsed.error.message}`);
  }

  return {
    ...DEFAULT_FEATURE_FLAGS,
    ...parsed.data.features,
  };
}

