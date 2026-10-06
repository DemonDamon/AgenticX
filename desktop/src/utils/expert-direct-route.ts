/**
 * 专家指令直达路由：把「请让数字专家「X」帮我完成任务。」这类句子从 Meta 会话
 * 改道到专家专属对话直接执行（无委派、无子智能体、无弹窗）。
 */

export interface ExpertDirectAvatar {
  id: string;
  name: string;
}

export interface ExpertDirectRoute {
  avatarId: string;
  avatarName: string;
  /** 送达专家的指令 = 原文全文（含追加的任务内容）。 */
  instruction: string;
}

/** 句首引导词：可选「请」+「让」+ 可选「数字」+「专家」。 */
const LEAD_RE = /^(?:请\s*)?让(?:数字)?专家\s*/;

/** 引用专家名的前后引号（含全角/中英文变体）。 */
const OPEN_QUOTES = "「『“\"'";
const CLOSE_QUOTES = "」』”\"'";

/**
 * 判断文本是否为「让专家X执行任务」的直达句式，并解析出目标专家。
 * 锚定句首，避免普通消息被误拦。
 */
export function matchExpertDirectSend(
  text: string,
  avatars: readonly ExpertDirectAvatar[],
): ExpertDirectRoute | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const lead = LEAD_RE.exec(raw);
  if (!lead) return null;
  const rest = raw.slice(lead[0].length);

  for (const avatar of avatars) {
    const name = String(avatar?.name ?? "").trim();
    const id = String(avatar?.id ?? "").trim();
    if (!name || !id || id.startsWith("group:")) continue;

    // 引号式：「阮和鸣」…（跳过开引号后精确匹配名字）
    if (OPEN_QUOTES.includes(rest[0] ?? "")) {
      const nameBody = rest.slice(1);
      if (!nameBody.startsWith(name)) continue;
      const afterName = nameBody.slice(name.length);
      if (CLOSE_QUOTES.includes(afterName[0] ?? "")) {
        return { avatarId: id, avatarName: name, instruction: raw };
      }
      continue;
    }
    // 无引号式：阮和鸣帮我…（名字精确前缀）
    if (rest.startsWith(name)) {
      return { avatarId: id, avatarName: name, instruction: raw };
    }
  }
  return null;
}

/**
 * autoSend 派发 ack：目标 pane 的 ChatPane 消费 pane:new-topic(autoSend) 后写入，
 * 派发方轮询消费确认，解决新 pane 尚未挂载事件监听的时序问题。
 */
const AUTO_SEND_ACKS = new Map<string, number>();

export function markExpertAutoSendConsumed(paneId: string): void {
  if (paneId) AUTO_SEND_ACKS.set(paneId, Date.now());
}

export function consumeExpertAutoSendAck(paneId: string): boolean {
  return AUTO_SEND_ACKS.delete(paneId);
}
