export type InstalledSkillCandidate = {
  name: string;
  base_dir?: string;
  source?: string;
  variants?: Array<{
    source?: string;
    base_dir?: string;
  }>;
};

function normalizedPath(value?: string): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isManagedMarketplaceInstall(
  source: string | undefined,
  baseDir: string | undefined,
  slug: string,
): boolean {
  const normalizedSource = String(source ?? "").trim().toLowerCase();
  if (normalizedSource !== "registry" && normalizedSource !== "skillhub") return false;
  return normalizedPath(baseDir).endsWith(
    `/.agenticx/skills/registry/${slug}`,
  );
}

export function findInstalledMarketplaceSkill<T extends InstalledSkillCandidate>(
  skills: T[],
  slug: string,
): T | null {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) return null;

  for (const skill of skills) {
    if (isManagedMarketplaceInstall(skill.source, skill.base_dir, normalizedSlug)) {
      return skill;
    }
    const registryVariant = skill.variants?.find((variant) =>
      isManagedMarketplaceInstall(variant.source, variant.base_dir, normalizedSlug),
    );
    if (registryVariant) {
      return {
        ...skill,
        base_dir: registryVariant.base_dir,
        source: registryVariant.source || skill.source,
      };
    }
  }
  return null;
}

export function hasAlternateSkillVariant(skill: InstalledSkillCandidate): boolean {
  const installedPath = normalizedPath(skill.base_dir);
  return Boolean(
    installedPath &&
      skill.variants?.some((variant) => {
        const variantPath = normalizedPath(variant.base_dir);
        return Boolean(variantPath && variantPath !== installedPath);
      }),
  );
}

export function buildSkillTryDraft(skillName: string): string {
  const normalizedName = String(skillName || "").trim();
  return normalizedName ? `@skill://${normalizedName} ` : "";
}

export function skillMarkdownPath(baseDir: string): string {
  return `${String(baseDir || "").replace(/[\\/]+$/u, "")}/SKILL.md`;
}
