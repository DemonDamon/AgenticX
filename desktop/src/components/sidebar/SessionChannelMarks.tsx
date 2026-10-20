import { useTranslation } from "react-i18next";

type ChannelKind = "wechat" | "feishu";

const TONE: Record<ChannelKind, { color: string; backgroundColor: string }> = {
  wechat: { color: "#25D366", backgroundColor: "rgba(37,211,102,0.15)" },
  feishu: { color: "#3370FF", backgroundColor: "rgba(51,112,255,0.15)" },
};

/** Small channel pills for a session bound to WeChat or Feishu. */
export function SessionChannelMarks({
  sessionId,
  wechatBoundId = "",
  feishuBoundId = "",
}: {
  sessionId: string;
  wechatBoundId?: string;
  feishuBoundId?: string;
}) {
  const { t } = useTranslation("sidebar");
  const kinds: ChannelKind[] = [];
  if (wechatBoundId && sessionId === wechatBoundId) kinds.push("wechat");
  if (feishuBoundId && sessionId === feishuBoundId) kinds.push("feishu");
  if (kinds.length === 0) return null;
  return (
    <>
      {kinds.map((kind) => (
        <span
          key={kind}
          className="inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
          style={TONE[kind]}
          title={t(kind === "wechat" ? "history.channelWechatHint" : "history.channelFeishuHint")}
        >
          {t(kind === "wechat" ? "history.channelWechat" : "history.channelFeishu")}
        </span>
      ))}
    </>
  );
}
