import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Toast } from "../../ds/Toast";

import githubIcon from "../../../assets/connectors/github.svg";
import gmailIcon from "../../../assets/connectors/gmail.svg";
import notionIcon from "../../../assets/connectors/notion.svg";
import slackIcon from "../../../assets/connectors/slack.svg";
import gdriveIcon from "../../../assets/connectors/gdrive.svg";
import airtableIcon from "../../../assets/connectors/airtable.svg";
import supabaseIcon from "../../../assets/connectors/supabase.svg";
import bigqueryIcon from "../../../assets/connectors/bigquery.svg";

type PreviewConnector = {
  id: string;
  name: string;
  description: string;
  iconSrc: string;
  availability: "coming_soon";
};

/**
 * Icons sourced from the same sets OpenConnector uses:
 * - `@iconify-json/logos` (CC0-1.0) for most brand marks
 * - `simple-icons/googlebigquery` for BigQuery (not in logos set)
 */
const PREVIEW_CONNECTORS: PreviewConnector[] = [
  {
    id: "github",
    name: "GitHub",
    description: "查看仓库、Issue 与 Pull Request",
    iconSrc: githubIcon,
    availability: "coming_soon",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "收发、搜索和整理邮件",
    iconSrc: gmailIcon,
    availability: "coming_soon",
  },
  {
    id: "notion",
    name: "Notion",
    description: "浏览页面与数据库内容",
    iconSrc: notionIcon,
    availability: "coming_soon",
  },
  {
    id: "slack",
    name: "Slack",
    description: "读取频道并发送消息",
    iconSrc: slackIcon,
    availability: "coming_soon",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    description: "查找与管理云端文件",
    iconSrc: gdriveIcon,
    availability: "coming_soon",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "读取和更新表格记录",
    iconSrc: airtableIcon,
    availability: "coming_soon",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "访问项目数据与服务",
    iconSrc: supabaseIcon,
    availability: "coming_soon",
  },
  {
    id: "bigquery",
    name: "BigQuery",
    description: "查询和分析数据集",
    iconSrc: bigqueryIcon,
    availability: "coming_soon",
  },
];

export function ConnectorsTab() {
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastOpen(true);
  }, []);

  return (
    <>
      <div className="space-y-4 p-4">
        <p className="text-xs text-text-muted">
          连接常用账号与服务，让 Near 在获得授权后调用对应能力。
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-text-muted">
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-bold leading-none text-amber-950"
            aria-hidden
          >
            !
          </span>
          <span>当前为界面预览，连接能力尚未开放。</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {PREVIEW_CONNECTORS.map((item) => (
            <div
              key={item.id}
              className="group flex min-h-[84px] items-center gap-3 rounded-xl border border-border bg-surface-card px-3 py-3 transition hover:bg-surface-hover"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white"
                aria-hidden
              >
                <img
                  src={item.iconSrc}
                  alt=""
                  className="h-[22px] w-[22px] object-contain"
                  draggable={false}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-strong">{item.name}</div>
                <div className="truncate text-xs text-text-muted">{item.description}</div>
              </div>
              {/*
                Use a plain button: ds/Button always injects px-3 py-1.5, which
                fights p-0 and shifts the Plus glyph off-center.
              */}
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                aria-label={`连接 ${item.name}`}
                onClick={() => showToast(`${item.name} 连接能力即将支持`)}
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Toast open={toastOpen} message={toastMessage} onClose={() => setToastOpen(false)} />
    </>
  );
}
