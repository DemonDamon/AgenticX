import type { AutomationTemplate } from "./types";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "daily-ai-news",
    name: "每日 AI 新闻推送",
    icon: "Newspaper",
    description: "关注当天 AI 领域的重要动态，侧重 AI coding 与具身智能方向。",
    defaultPrompt:
      "关注当天 AI 领域的重要动态，侧重 AI coding 与具身智能方向。筛选 3-5 条有价值的信息，简要说明事件内容及值得关注的原因。",
    defaultFrequency: { type: "daily", time: "09:00", days: ALL_DAYS },
  },
  {
    id: "daily-english-words",
    name: "每日 5 个英语单词",
    icon: "Languages",
    description: "每天推荐 5 个高频实用英语单词，附例句与记忆技巧。",
    defaultPrompt:
      "推荐 5 个高频实用英语单词（偏技术/职场），给出音标、中文释义、英文例句及简单记忆技巧。",
    defaultFrequency: { type: "daily", time: "08:00", days: ALL_DAYS },
  },
  {
    id: "weekly-work-report",
    name: "每周工作周报",
    icon: "FileText",
    description: "每周五汇总仓库 PR 与 Issue 进展，生成结构化周报。",
    defaultPrompt:
      "汇总本周的工作进展，整理代码提交、PR 合并、Issue 关闭情况，按模块分类输出结构化周报。",
    defaultFrequency: { type: "daily", time: "17:00", days: [5] },
  },
  {
    id: "daily-code-review",
    name: "每日代码审查提醒",
    icon: "GitPullRequest",
    description: "工作日提醒待审查的 PR，列出优先级。",
    defaultPrompt:
      "检查当前工作区仓库中待审查的 Pull Request，按紧急程度排序，给出审查建议摘要。",
    defaultFrequency: { type: "daily", time: "10:00", days: WEEKDAYS },
  },
  {
    id: "meeting-prep",
    name: "会议前准备",
    icon: "CalendarCheck",
    description: "在会议开始前提醒你整理议题、准备材料。",
    defaultPrompt:
      "提醒我即将到来的会议，帮我整理今天的待办事项和可能需要讨论的议题。",
    defaultFrequency: { type: "daily", time: "09:30", days: WEEKDAYS },
  },
  {
    id: "daily-learning",
    name: "每日学习打卡",
    icon: "GraduationCap",
    description: "每天抛出一个有趣问题，先提问再给出解答。",
    defaultPrompt:
      "抛出一个有趣的技术/科学问题，先让我思考，然后给出简明扼要的解答和延伸阅读建议。",
    defaultFrequency: { type: "daily", time: "12:00", days: ALL_DAYS },
  },
  {
    id: "project-progress",
    name: "项目进度追踪",
    icon: "BarChart3",
    description: "定期扫描工作区项目，汇总代码变更与 TODO。",
    defaultPrompt:
      "扫描工作区中的项目，汇总最近的代码变更量、新增 TODO/FIXME、未关闭的 Issue，输出进度摘要。",
    defaultFrequency: { type: "interval", hours: 4, days: WEEKDAYS },
  },
  {
    id: "dep-security-scan",
    name: "每周依赖安全扫描",
    icon: "Shield",
    description: "每周一扫描项目依赖，报告已知安全漏洞。",
    defaultPrompt:
      "扫描当前工作区的项目依赖（pip/npm），检查是否存在已知安全漏洞，输出风险等级和修复建议。",
    defaultFrequency: { type: "daily", time: "10:00", days: [1] },
  },
  {
    id: "custom-reminder",
    name: "自定义定时提醒",
    icon: "Bell",
    description: "按你设定的时间发送自定义提醒消息。",
    defaultPrompt: "提醒我：",
    defaultFrequency: { type: "daily", time: "09:00", days: ALL_DAYS },
  },
];
