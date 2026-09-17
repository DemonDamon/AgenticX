export const NEAR_BOX_IDLE_MOODS = [
  "curious",
  "proud",
  "happy",
  "laughing",
  "listening",
  "surprised",
  "sleeping",
] as const;

export type NearBoxMood = (typeof NEAR_BOX_IDLE_MOODS)[number] | "excited";

export const NEAR_BOX_IDLE_HOLD_MS = 6200;

export function resolveNearBoxMood(input: { hovered?: boolean; idle?: NearBoxMood }): NearBoxMood {
  if (input.hovered) return "excited";
  return input.idle ?? "proud";
}

export function nextNearBoxIdleMood(current: NearBoxMood): (typeof NEAR_BOX_IDLE_MOODS)[number] {
  const idle = NEAR_BOX_IDLE_MOODS.includes(current as (typeof NEAR_BOX_IDLE_MOODS)[number])
    ? (current as (typeof NEAR_BOX_IDLE_MOODS)[number])
    : "proud";
  const i = NEAR_BOX_IDLE_MOODS.indexOf(idle);
  return NEAR_BOX_IDLE_MOODS[(i + 1) % NEAR_BOX_IDLE_MOODS.length] ?? "proud";
}
