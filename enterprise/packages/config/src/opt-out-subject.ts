/**
 * 个人关闭记录的主体 id：`mcp:<ulid>` / `skill:<ulid>` / `model:<provider>/<name>`。
 *
 * 能力用不可变的 ULID（见 capability-id），模型用的是 `provider/model` 这个既有的
 * 可见性 id——它本来就是可见模型表里的主键形态，换一种写法只会让两边对不上。
 */

import { isCapabilityId } from "./capability-id";

export const MODEL_OPT_OUT_PREFIX = "model:";

export function modelOptOutSubject(modelId: string): string {
  const id = String(modelId ?? "").trim();
  if (!id) throw new Error("model id is required");
  return `${MODEL_OPT_OUT_PREFIX}${id}`;
}

export function isModelOptOutSubject(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MODEL_OPT_OUT_PREFIX) &&
    value.length > MODEL_OPT_OUT_PREFIX.length;
}

/** `model:openai/gpt-4` → `openai/gpt-4`；不是模型主体则返回 null。 */
export function parseModelOptOutSubject(subject: string): string | null {
  if (!isModelOptOutSubject(subject)) return null;
  return subject.slice(MODEL_OPT_OUT_PREFIX.length);
}

/** 一条记录是否是这张表认得的主体。脏数据不该冒充一次关闭。 */
export function isOptOutSubject(value: unknown): value is string {
  return isCapabilityId(value) || isModelOptOutSubject(value);
}

/** 从混合列表里挑出模型那部分，还原成可见模型 id。 */
export function modelIdsFromSubjects(subjects: readonly string[]): string[] {
  const out: string[] = [];
  for (const subject of subjects) {
    const modelId = parseModelOptOutSubject(subject);
    if (modelId && !out.includes(modelId)) out.push(modelId);
  }
  return out;
}
