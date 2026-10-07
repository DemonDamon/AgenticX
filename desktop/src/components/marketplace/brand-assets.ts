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
  gildata: gildataIcon,
  yingmi: yingmiIcon,
  comein: comeinIcon,
  dichan: dichanIcon,
  kuaidi100: kuaidi100Icon,
  lawstar: lawstarIcon,
  esign: esignIcon,
  pkulaw: pkulawIcon,
  neocrm: neocrmIcon,
};
