/** Agent prompt for installing the Alpha派 scraper skill from its official guide. */

const ALPHAPAI_INSTALL_DOC =
  "https://open-api.rabyte.cn/alpha/open-api/v1/file/api-docs/alphapai-research/install.md";
const ALPHAPAI_SKILL_NAME = "registry/alphapai-scraper";

/** Build a Meta-Agent install prompt for alphapai-scraper. */
export function buildAlphapaiScraperInstallPrompt(): string {
  return [
    "请为本机和创智派 / Meta-Agent 安装第三方技能「alphapai-scraper」。",
    "",
    `官方安装文档：${ALPHAPAI_INSTALL_DOC}`,
    "",
    "安装要求（本次请求已授权安装，请直接完成，不要再让用户回复“继续安装”）：",
    "1. 阅读并严格按照上述官方文档下载 Alpha派技能压缩包；不要使用搜索结果或非官方替代包。",
    "2. 将压缩包解压到临时目录，定位其中的 SKILL.md；不要把压缩包原样当作技能写入。",
    `3. 使用 skill_manage action='create'，name='${ALPHAPAI_SKILL_NAME}'，from_path=<解压后的 SKILL.md 绝对路径> 一次完成落盘；不要用 file_write/file_edit 直接写入 ~/.agenticx/skills/。`,
    "4. 安装完成后检查 skill_manage 返回的 discoverable=true，并调用 skill_list 自检；失败时直接汇报具体错误。",
    "5. 安装成功后汇报技能路径与可发现状态。",
    "",
    "不要修改和创智派内置 skill 包，也不要把该技能标成内置技能。",
  ].join("\n");
}
