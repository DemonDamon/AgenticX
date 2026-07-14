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
    description: "管理会议、录制、纪要与参会报告",
    iconSrc: tencentMeetingIcon,
  },
  {
    id: "tapd",
    name: "TAPD",
    description: "管理需求、缺陷、任务与迭代",
    iconSrc: tapdIcon,
  },
  { id: "github", name: "GitHub", description: "查看仓库、Issue 与 Pull Request", iconSrc: githubIcon },
  {
    id: "feishu",
    name: "飞书",
    description: "消息、文档、多维表格、日历与任务",
    iconSrc: feishuIcon,
  },
  {
    id: "wecom",
    name: "企业微信",
    description: "消息、文档、智能表格、通讯录、待办与会议",
    iconSrc: wecomIcon,
  },
  {
    id: "qqmail",
    name: "Agent Mail",
    description: "Agent 专属邮箱：收发、搜索、回复与转发",
    iconSrc: qqmailIcon,
  },
  { id: "gmail", name: "Gmail", description: "收发、搜索和整理邮件", iconSrc: gmailIcon },
  { id: "notion", name: "Notion", description: "浏览页面与数据库内容", iconSrc: notionIcon },
  { id: "slack", name: "Slack", description: "读取频道并发送消息", iconSrc: slackIcon },
  { id: "gdrive", name: "Google Drive", description: "查找与管理云端文件", iconSrc: gdriveIcon },
  { id: "airtable", name: "Airtable", description: "读取和更新表格记录", iconSrc: airtableIcon },
  { id: "supabase", name: "Supabase", description: "访问项目数据与服务", iconSrc: supabaseIcon },
  { id: "bigquery", name: "BigQuery", description: "查询和分析数据集", iconSrc: bigqueryIcon },
];
