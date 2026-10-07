import tencentMeetingIcon from "../../../assets/connectors/tencent-meeting.svg";
import tapdIcon from "../../../assets/connectors/tapd.svg";
import githubIcon from "../../../assets/connectors/github.svg";
import feishuIcon from "../../../assets/connectors/feishu.svg";
import wecomIcon from "../../../assets/connectors/wecom.svg";
import qqmailIcon from "../../../assets/connectors/qqmail.svg";
import gmailIcon from "../../../assets/connectors/gmail.svg";
import notionIcon from "../../../assets/connectors/notion.svg";
import slackIcon from "../../../assets/connectors/slack.svg";
import gdriveIcon from "../../../assets/connectors/gdrive.svg";
import airtableIcon from "../../../assets/connectors/airtable.svg";
import supabaseIcon from "../../../assets/connectors/supabase.svg";
import bigqueryIcon from "../../../assets/connectors/bigquery.svg";

export type ConnectorId =
  | "tencent-meeting"
  | "tapd"
  | "github"
  | "feishu"
  | "wecom"
  | "qqmail"
  | "gmail"
  | "notion"
  | "slack"
  | "gdrive"
  | "airtable"
  | "supabase"
  | "bigquery";

export type ConnectorDefinition = {
  id: ConnectorId;
  name: string;
  description: string;
  iconSrc: string;
};

/**
 * Single source of truth for the connectors catalog — shared by the full Settings
 * tab and the compact chat composer menu.
 *
 * Icon sources (aligned with OpenConnector):
 * - GitHub / Gmail / Notion / Slack / Drive / Airtable / Supabase / BigQuery:
 *   extracted from `@iconify-json/logos` (same package OpenConnector web console uses).
 * - 腾讯会议: official favicon from meeting.tencent.com (via Google s2 favicons).
 * - TAPD: official wordmark SVG from static-open.tapd.cn.
 * - 飞书: official bird mark (teal/blue), same brand asset used by connector catalogs.
 * - 企业微信: iconfont.cn「企业微信」/ WeCom 多色标（蓝描边气泡 + 四色花瓣），
 *   与官网锁头图一致；非个人微信双绿气泡 App 图标。
 */
export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "tencent-meeting",
    name: "腾讯会议",
    description: "管理腾讯会议日程、录制回放、会议纪要与参会报告，在对话中创建会议、查询录制并汇总会后结论。",
    iconSrc: tencentMeetingIcon,
  },
  {
    id: "tapd",
    name: "TAPD",
    description: "管理 TAPD 需求、缺陷、任务与迭代，在对话中跟进研发进度、更新状态并汇总迭代交付情况。",
    iconSrc: tapdIcon,
  },
  { id: "github", name: "GitHub", description: "查看 GitHub 仓库、Issue 与 Pull Request，在对话中检索代码变更、审阅讨论并跟踪开源协作进度。", iconSrc: githubIcon },
  {
    id: "feishu",
    name: "飞书",
    description: "飞书消息、云文档、多维表格、日历与任务：把团队协作与知识沉淀接到助手，便于催办、检索与日程安排。",
    iconSrc: feishuIcon,
  },
  {
    id: "wecom",
    name: "企业微信",
    description: "企业微信消息、文档、智能表格、通讯录、待办与会议，把企业内部沟通与协作能力接入助手工作流。",
    iconSrc: wecomIcon,
  },
  {
    id: "qqmail",
    name: "Agent Mail",
    description: "Agent 专属邮箱：收发、搜索、回复与转发邮件，让助手在隔离邮箱中处理通知、摘要与外联沟通。",
    iconSrc: qqmailIcon,
  },
  { id: "gmail", name: "Gmail", description: "Gmail 收发、搜索与整理邮件：在对话中查找线程、起草回复并管理标签，把邮件工作流交给助手。", iconSrc: gmailIcon },
  { id: "notion", name: "Notion", description: "浏览与检索 Notion 页面与数据库内容，把知识库、项目笔记与结构化记录接到助手问答与摘要。", iconSrc: notionIcon },
  { id: "slack", name: "Slack", description: "读取 Slack 频道并发送消息：汇总讨论、检索历史并代发通知，把团队即时通讯接到助手。", iconSrc: slackIcon },
  { id: "gdrive", name: "Google Drive", description: "查找与管理 Google Drive 云端文件：搜索文档、整理目录并读取内容摘要，便于资料检索与协作。", iconSrc: gdriveIcon },
  { id: "airtable", name: "Airtable", description: "读取和更新 Airtable 表格记录：查询视图、写入字段与同步业务数据，把轻量数据库接到助手。", iconSrc: airtableIcon },
  { id: "supabase", name: "Supabase", description: "访问 Supabase 项目数据与服务：查询表、调用边缘函数与管理后端资源，支撑应用数据对话操作。", iconSrc: supabaseIcon },
  { id: "bigquery", name: "BigQuery", description: "查询和分析 BigQuery 数据集：用自然语言发起分析、探索表结构与汇总指标，把数仓洞察带到对话里。", iconSrc: bigqueryIcon },
];
