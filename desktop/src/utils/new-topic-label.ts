export const NEW_TOPIC_INHERITS_CONTEXT = false;

export function newTopicTriggerLabel({
  displayName,
  isGroup,
}: {
  displayName: string;
  isGroup: boolean;
}): string {
  const name = displayName.trim();
  if (!name) return "新建对话";
  if (isGroup) return `在${name}中新建对话`;
  return /[A-Za-z0-9]/.test(name) ? `与 ${name} 新建对话` : `与${name}新建对话`;
}
