/** 平台配置下除 /policy 外的 /admin/* 页，共用同一条动态路由以免 webpack 每项都 Compiling。 */
export const PLATFORM_SECTION_IDS = [
  "models",
  "channels",
  "cache",
  "api-tokens",
  "mcp-servers",
  "capabilities",
  "plugins",
] as const;

export type PlatformSectionId = (typeof PLATFORM_SECTION_IDS)[number];

export function isPlatformSection(value: string): value is PlatformSectionId {
  return (PLATFORM_SECTION_IDS as readonly string[]).includes(value);
}
