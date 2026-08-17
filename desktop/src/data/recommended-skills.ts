/**
 * Curated skill install shortcuts shown under 技能市场 → 官方推荐.
 * `tier` drives 企业官方 / 第三方 filter chips (not the same as builtin skills).
 */

import tencentDocsIcon from "../assets/recommended/tencent-docs.svg";
import tencentImaIcon from "../assets/recommended/tencent-ima.svg";
import tencentMeetingIcon from "../assets/recommended/tencent-meeting.svg";
import officecliIcon from "../assets/recommended/officecli.svg";
import archscribeIcon from "../assets/recommended/archscribe.svg";

/** 推荐位来源档：企业官方（当前 Desktop 背书）vs 第三方（外部厂商/开源）。 */
export type RecommendedSkillTier = "enterprise" | "third_party";

export type RecommendedSkillCta = "official_site" | "install";

export type RecommendedSkill = {
  id: string;
  name: string;
  provider: string;
  description: string;
  icon_src: string;
  official_url: string;
  category: string;
  /** 来源档标签，用于推荐区筛选。 */
  tier: RecommendedSkillTier;
  /** 主 CTA：外链指引 vs 一键安装。 */
  cta: RecommendedSkillCta;
  /** 已发布的市场包 slug；存在时复用原生预览/扫描/安装流程。 */
  marketplace_slug?: string;
  /** SkillHub 发布者命名空间；与 slug 一起定位唯一包。 */
  marketplace_namespace?: string;
};

export const RECOMMENDED_TIER_LABEL: Record<RecommendedSkillTier, string> = {
  enterprise: "企业官方",
  third_party: "第三方",
};

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: "officecli",
    name: "OfficeCLI",
    provider: "iOfficeAI",
    description:
      "Agent 创建/编辑 Word、Excel、PowerPoint（无需安装 Microsoft Office）；点安装后由 Meta-Agent 拉取技能并检测本机 officecli 二进制。",
    icon_src: officecliIcon,
    official_url: "https://github.com/iOfficeAI/OfficeCLI",
    category: "Office 创作",
    tier: "third_party",
    cta: "install",
  },
  {
    id: "archscribe",
    name: "Archscribe",
    provider: "lazypay",
    description:
      "手绘风动态架构/流程图（深色霓虹或浅色纸面）；输出可编辑 Excalidraw、PNG 与动画 GIF。点安装后由 Meta-Agent 克隆仓库并安装 Python 依赖。",
    icon_src: archscribeIcon,
    official_url: "https://github.com/lazypay/Archscribe",
    category: "架构可视化",
    tier: "third_party",
    cta: "install",
  },
  {
    id: "alphapai-research",
    name: "alphapai-research",
    provider: "Alpha派",
    description:
      "从 SkillHub 获取 Alpha派网页研究技能；点击后自动完成整包下载、安全检查和安装。",
    icon_src: "",
    official_url: "https://skillhub.cn/skills/alphapai-research",
    category: "网页抓取",
    tier: "third_party",
    cta: "install",
    marketplace_slug: "alphapai-research",
    marketplace_namespace: "clawhub_boteeenchan-ship-it",
  },
  {
    id: "tencent-docs",
    name: "腾讯文档",
    provider: "腾讯",
    description: "按官方页面指引在和创智派 / Meta-Agent 中接入腾讯文档技能。",
    icon_src: tencentDocsIcon,
    official_url: "https://docs.qq.com/scenario/open-claw.html?nlc=1",
    category: "文档协作",
    tier: "enterprise",
    cta: "official_site",
  },
  {
    id: "tencent-ima",
    name: "ima 知识库",
    provider: "腾讯",
    description: "ima 笔记与知识库（读取、写入、检索）；请按官网申请 API Key。",
    icon_src: tencentImaIcon,
    official_url: "https://ima.qq.com/agent-interface",
    category: "知识库",
    tier: "enterprise",
    cta: "official_site",
  },
  {
    id: "tencent-meeting",
    name: "腾讯会议",
    provider: "腾讯",
    description: "会议与日程、参会统计、转写与纪要等能力；安装步骤以官网说明为准。",
    icon_src: tencentMeetingIcon,
    official_url: "https://meeting.tencent.com/ai-skill/",
    category: "会议",
    tier: "enterprise",
    cta: "official_site",
  },
];
