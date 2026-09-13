export const NEW_TOPIC_INHERITS_CONTEXT = false;

type ChatTranslate = (key: string, options?: Record<string, unknown>) => string;

export function newTopicTriggerLabel({
  displayName,
  isGroup,
  t,
}: {
  displayName: string;
  isGroup: boolean;
  t?: ChatTranslate;
}): string {
  const name = displayName.trim();
  if (!name) return t ? t("newTopic.generic") : "新建对话";
  if (isGroup) return t ? t("newTopic.inGroup", { name }) : `在${name}中新建对话`;
  return /[A-Za-z0-9]/.test(name)
    ? t
      ? t("newTopic.withLatin", { name })
      : `与 ${name} 新建对话`
    : t
      ? t("newTopic.withCjk", { name })
      : `与${name}新建对话`;
}
