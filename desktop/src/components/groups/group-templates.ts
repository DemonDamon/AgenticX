/**
 * Near-native group-chat templates. Frontend-only static presets: selecting a
 * template pre-fills the group name and auto-selects existing avatars whose
 * name/role fuzzy-matches `memberRoleHints`. No fake members are created — if
 * nothing matches, the user picks members manually.
 */
export interface GroupTemplate {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon name (resolved via ICON_MAP in ProjectsView). */
  icon: string;
  /** Keywords matched (case-insensitive `includes`) against avatar name/role. */
  memberRoleHints: string[];
}

export const GROUP_TEMPLATES: GroupTemplate[] = [
  {
    id: "product-flow",
    name: "产品需求全流程",
    description: "从需求澄清、PRD 撰写到研发测试验收的完整闭环。",
    icon: "ClipboardList",
    memberRoleHints: ["产品", "prd", "需求", "研发", "测试", "开发"],
  },
  {
    id: "market-research",
    name: "市场调研与竞品分析",
    description: "深度调研、竞品拆解、报告产出到结论评审。",
    icon: "LineChart",
    memberRoleHints: ["调研", "研究", "分析", "行业", "市场", "竞品"],
  },
  {
    id: "team-kb",
    name: "团队知识库",
    description: "持续沉淀 SOP、经验与 FAQ，让团队知识可复用。",
    icon: "BookOpen",
    memberRoleHints: ["知识", "文档", "写作", "编辑", "改稿"],
  },
  {
    id: "delivery",
    name: "项目交付",
    description: "统筹客户需求、计划、风险与周报，稳态交付。",
    icon: "PackageCheck",
    memberRoleHints: ["交付", "项目", "管理", "运营", "PM"],
  },
  {
    id: "bug-track",
    name: "缺陷跟踪与验收",
    description: "统一测试用例，持续跟踪 Bug 与验收结论。",
    icon: "Bug",
    memberRoleHints: ["测试", "bug", "质量", "验收", "qa"],
  },
  {
    id: "fullstack-squad",
    name: "全栈研发小队",
    description: "架构、前后端与代码评审多角色协同攻坚。",
    icon: "Boxes",
    memberRoleHints: ["开发", "工程", "架构", "前端", "后端", "全栈", "代码"],
  },
];

/** Given a template + current avatars, return the ids to pre-select. */
export function matchTemplateAvatarIds(
  hints: string[],
  avatars: Array<{ id: string; name: string; role: string }>
): string[] {
  const lowered = hints.map((h) => h.toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];
  const ids: string[] = [];
  for (const a of avatars) {
    const hay = `${a.name ?? ""} ${a.role ?? ""}`.toLowerCase();
    if (lowered.some((h) => hay.includes(h))) ids.push(a.id);
  }
  return ids;
}
