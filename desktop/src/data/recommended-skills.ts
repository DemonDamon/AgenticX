/**
 * Curated official third-party skill install shortcuts (prompts only; no binary hosting).
 * Provider pages publish these instructions for OpenClaw-compatible agents.
 */

import tencentDocsIcon from "../assets/recommended/tencent-docs.svg";
import tencentImaIcon from "../assets/recommended/tencent-ima.svg";
import tencentMeetingIcon from "../assets/recommended/tencent-meeting.svg";

export type RecommendedSkill = {
  id: string;
  name: string;
  provider: string;
  description: string;
  icon_src: string;
  official_url: string;
  category: string;
};

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: "tencent-docs",
    name: "腾讯文档",
    provider: "腾讯",
    description: "按官方页面指引在 Machi / Meta-Agent 中接入腾讯文档技能。",
    icon_src: tencentDocsIcon,
    official_url: "https://docs.qq.com/scenario/open-claw.html?nlc=1",
    category: "文档协作",
  },
  {
    id: "tencent-ima",
    name: "ima 知识库",
    provider: "腾讯",
    description: "ima 笔记与知识库（读取、写入、检索）；请按官网申请 API Key。",
    icon_src: tencentImaIcon,
    official_url: "https://ima.qq.com/agent-interface",
    category: "知识库",
  },
  {
    id: "tencent-meeting",
    name: "腾讯会议",
    provider: "腾讯",
    description: "会议与日程、参会统计、转写与纪要等能力；安装步骤以官网说明为准。",
    icon_src: tencentMeetingIcon,
    official_url: "https://meeting.tencent.com/ai-skill/",
    category: "会议",
  },
];
