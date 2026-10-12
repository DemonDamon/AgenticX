/**
 * 品牌 key → 图标资源映射(本地打包优先)。
 * 国产服务图标全部本地打包,保证国内网络环境下即时、稳定加载;
 * 国际品牌不在此映射,由 MarketIcon 走 Simple Icons CDN 兜底。
 *
 * 图标来源(与 connector-catalog 的注释口径一致):
 * - LobeHub @lobehub/icons-static-svg(MIT)color 变体:
 *   bocha / tencent / qwen / zhipu / kimi / doubao / hunyuan / minimax / baichuan
 * - Simple Icons 品牌官方矢量: baidu / zhihu / bilibili / qq / taobao /
 *   xiaohongshu / meituan / kuaishou
 * - 官方站点 favicon(转 PNG): metaso(metaso.cn 128px) / mineru(mineru.net 48px)
 * - 飞书/Lark: 复用 assets/connectors/feishu.svg(同一鸟形标)
 */

import baichuanIcon from "../../assets/marketplace/brands/baichuan.svg";
import baiduIcon from "../../assets/marketplace/brands/baidu.svg";
import bilibiliIcon from "../../assets/marketplace/brands/bilibili.svg";
import bochaIcon from "../../assets/marketplace/brands/bocha.svg";
import doubaoIcon from "../../assets/marketplace/brands/doubao.svg";
import hunyuanIcon from "../../assets/marketplace/brands/hunyuan.svg";
import kimiIcon from "../../assets/marketplace/brands/kimi.svg";
import kuaishouIcon from "../../assets/marketplace/brands/kuaishou.svg";
import meituanIcon from "../../assets/marketplace/brands/meituan.svg";
import metasoIcon from "../../assets/marketplace/brands/metaso.png";
import mineruIcon from "../../assets/marketplace/brands/mineru.png";
import minimaxIcon from "../../assets/marketplace/brands/minimax.svg";
import qqIcon from "../../assets/marketplace/brands/qq.svg";
import qwenIcon from "../../assets/marketplace/brands/qwen.svg";
import taobaoIcon from "../../assets/marketplace/brands/taobao.svg";
import tencentIcon from "../../assets/marketplace/brands/tencent.svg";
import xiaohongshuIcon from "../../assets/marketplace/brands/xiaohongshu.svg";
import zhihuIcon from "../../assets/marketplace/brands/zhihu.svg";
import zhipuIcon from "../../assets/marketplace/brands/zhipu.svg";
import feishuIcon from "../../assets/connectors/feishu.svg";
import amapIcon from "../../assets/connectors/stubs/amap.png";
import asanaIcon from "../../assets/connectors/stubs/asana.svg";
import baiduMapsIcon from "../../assets/connectors/stubs/baidu-maps.png";
import cloudflareStubIcon from "../../assets/connectors/stubs/cloudflare.svg";
import comeinIcon from "../../assets/connectors/stubs/comein.png";
import dichanIcon from "../../assets/connectors/stubs/dichan.png";
import dingtalkIcon from "../../assets/connectors/stubs/dingtalk.png";
import esignIcon from "../../assets/connectors/stubs/esign.png";
import gildataIcon from "../../assets/connectors/stubs/gildata.png";
import giteeIcon from "../../assets/connectors/stubs/gitee.svg";
import gitlabStubIcon from "../../assets/connectors/stubs/gitlab.svg";
import kuaidi100Icon from "../../assets/connectors/stubs/kuaidi100.png";
import lawstarIcon from "../../assets/connectors/stubs/lawstar.png";
import linearIcon from "../../assets/connectors/stubs/linear.svg";
import neocrmIcon from "../../assets/connectors/stubs/neocrm.png";
import outlookIcon from "../../assets/connectors/stubs/outlook.png";
import pkulawIcon from "../../assets/connectors/stubs/pkulaw.png";
import qichachaIcon from "../../assets/connectors/stubs/qichacha.png";
import qingflowIcon from "../../assets/connectors/stubs/qingflow.png";
import tencentDocsIcon from "../../assets/connectors/stubs/tencent-docs.png";
import tencentMapsIcon from "../../assets/connectors/stubs/tencent-maps.png";
import tianyanchaIcon from "../../assets/connectors/stubs/tianyancha.png";
import wpsIcon from "../../assets/connectors/stubs/wps.png";
import yingmiIcon from "../../assets/connectors/stubs/yingmi.png";
import zoomIcon from "../../assets/connectors/stubs/zoom.svg";
import zsxqIcon from "../../assets/connectors/stubs/zsxq.png";
import cnbIcon from "../../assets/connectors/stubs/cnb.png";
import edgeoneIcon from "../../assets/connectors/stubs/edgeone.png";
import fayanIcon from "../../assets/connectors/stubs/fayan.png";
import feishuCliIcon from "../../assets/connectors/stubs/feishu-cli.png";
import gangtiseIcon from "../../assets/connectors/stubs/gangtise.png";
import ifindIcon from "../../assets/connectors/stubs/ifind.png";
import imaIcon from "../../assets/connectors/stubs/ima.png";
import jinshujuIcon from "../../assets/connectors/stubs/jinshuju.png";
import lexiangIcon from "../../assets/connectors/stubs/lexiang.png";
import mokaIcon from "../../assets/connectors/stubs/moka.png";
import mozlenIcon from "../../assets/connectors/stubs/mozlen.png";
import qixinIcon from "../../assets/connectors/stubs/qixin.png";
import tdxIcon from "../../assets/connectors/stubs/tdx.png";
import wjIcon from "../../assets/connectors/stubs/wj.png";
import wkinfoIcon from "../../assets/connectors/stubs/wkinfo.png";
import wpsProjectIcon from "../../assets/connectors/stubs/wps-project.png";
import xiaoeIcon from "../../assets/connectors/stubs/xiaoe.png";
import yuandianIcon from "../../assets/connectors/stubs/yuandian.png";
import zhihuiyaIcon from "../../assets/connectors/stubs/zhihuiya.png";


import githubConnIcon from "../../assets/connectors/github.svg";
import qqmailConnIcon from "../../assets/connectors/qqmail.svg";
import gmailConnIcon from "../../assets/connectors/gmail.svg";
import slackConnIcon from "../../assets/connectors/slack.svg";
import notionConnIcon from "../../assets/connectors/notion.svg";
import gdriveConnIcon from "../../assets/connectors/gdrive.svg";
import airtableConnIcon from "../../assets/connectors/airtable.svg";
import supabaseConnIcon from "../../assets/connectors/supabase.svg";
import bigqueryConnIcon from "../../assets/connectors/bigquery.svg";

export const BRAND_ICON_SRC: Readonly<Record<string, string>> = {
  feishu: feishuIcon,
  bocha: bochaIcon,
  zhipu: zhipuIcon,
  qwen: qwenIcon,
  kimi: kimiIcon,
  doubao: doubaoIcon,
  hunyuan: hunyuanIcon,
  minimax: minimaxIcon,
  baichuan: baichuanIcon,
  tencent: tencentIcon,
  baidu: baiduIcon,
  zhihu: zhihuIcon,
  bilibili: bilibiliIcon,
  qq: qqIcon,
  taobao: taobaoIcon,
  xiaohongshu: xiaohongshuIcon,
  meituan: meituanIcon,
  kuaishou: kuaishouIcon,
  metaso: metasoIcon,
  mineru: mineruIcon,
  qingflow: qingflowIcon,
  zsxq: zsxqIcon,
  amap: amapIcon,
  "baidu-maps": baiduMapsIcon,
  "tencent-maps": tencentMapsIcon,
  "tencent-docs": tencentDocsIcon,
  wps: wpsIcon,
  zoom: zoomIcon,
  gitlab: gitlabStubIcon,
  gitee: giteeIcon,
  linear: linearIcon,
  asana: asanaIcon,
  outlook: outlookIcon,
  tianyancha: tianyanchaIcon,
  qichacha: qichachaIcon,
  dingtalk: dingtalkIcon,
  cloudflare: cloudflareStubIcon,
  cnb: cnbIcon,
  edgeone: edgeoneIcon,
  fayan: fayanIcon,
  gangtise: gangtiseIcon,
  ifind: ifindIcon,
  ima: imaIcon,
  jinshuju: jinshujuIcon,
  lexiang: lexiangIcon,
  moka: mokaIcon,
  mozlen: mozlenIcon,
  qixin: qixinIcon,
  tdx: tdxIcon,
  wj: wjIcon,
  wkinfo: wkinfoIcon,
  "wps-project": wpsProjectIcon,
  xiaoe: xiaoeIcon,
  yuandian: yuandianIcon,
  zhihuiya: zhihuiyaIcon,

  gildata: gildataIcon,
  yingmi: yingmiIcon,
  comein: comeinIcon,
  dichan: dichanIcon,
  kuaidi100: kuaidi100Icon,
  lawstar: lawstarIcon,
  esign: esignIcon,
  pkulaw: pkulawIcon,
  neocrm: neocrmIcon,
  github: githubConnIcon,
  qqmail: qqmailConnIcon,
  gmail: gmailConnIcon,
  slack: slackConnIcon,
  notion: notionConnIcon,
  gdrive: gdriveConnIcon,
  airtable: airtableConnIcon,
  supabase: supabaseConnIcon,
  bigquery: bigqueryConnIcon,
};


/**
 * 字形标(SVG / Simple Icons)瓷砖底色:全出血品牌色,替代白垫。
 * key 与 BRAND_RULES / Simple Icons slug 对齐。
 */
export const MARK_TILE_BG: Readonly<Record<string, string>> = {
  github: "#24292F",
  gitlab: "#FC6D26",
  gitee: "#C71D23",
  notion: "#000000",
  linear: "#5E6AD2",
  asana: "#F06A6A",
  zoom: "#0B5CFF",
  cloudflare: "#F38020",
  supabase: "#3ECF8E",
  gmail: "#EA4335",
  slack: "#4A154B",
  gdrive: "#1A73E8",
  airtable: "#18BFFF",
  bigquery: "#669DF6",
  postgresql: "#4169E1",
  mysql: "#4479A1",
  mongodb: "#47A248",
  redis: "#DC382D",
  docker: "#2496ED",
  kubernetes: "#2496ED",
  vercel: "#000000",
  stripe: "#635BFF",
  figma: "#F24E1E",
  jenkins: "#D24939",
  grafana: "#F46800",
  elasticsearch: "#005571",
  sentry: "#362D59",
  anthropic: "#D4A27F",
  deepseek: "#4D6BFE",
  googlegemini: "#8E75B2",
  ollama: "#000000",
  alibabacloud: "#FF6A00",
  wechat: "#07C160",
};

/**
 * 字形标的明暗口径(本地打包 SVG + Simple Icons CDN 默认品牌色),用于主题自适应:
 * - dark:近黑/深色单色字形(深色主题反白;浅色主题原样)。
 * - light:近白单色字形(浅色主题压黑;深色主题原样)。
 * - duo:自带黑白对比的完整标(如 Notion 白底方块 + 黑边黑 N),任何主题都不加滤镜,
 *   否则 brightness(0) 会把白底与黑 N 一起压成实心黑块。
 * 品牌表优先于运行时探测:开发态 Vite 给的是 /src/...svg URL,拿不到内联 SVG 内容。
 */
export type MarkTone = "dark" | "light" | "duo";

export const MARK_TONE: Readonly<Record<string, MarkTone>> = {
  // 本地打包
  github: "dark", // #161614
  qqmail: "dark", // #111111
  notion: "duo", // 官方标:白色方块(fill #fff)+ 黑色描边与 N(默认 fill)
  // Simple Icons CDN(默认即品牌色):近黑 / 深色品牌
  vercel: "dark", // #000000
  ollama: "dark", // #000000
  anthropic: "dark", // #191919
  sentry: "dark", // #362D59
  elasticsearch: "dark", // #005571
};

/** 近黑字形:仅在深色/dim 瓷砖上需 CSS brightness(0) invert(1) 反白(浅色主题保持原色)。 */
export const MARK_INVERT_BRANDS: ReadonlySet<string> = new Set(
  Object.entries(MARK_TONE)
    .filter(([, tone]) => tone === "dark")
    .map(([brand]) => brand),
);
