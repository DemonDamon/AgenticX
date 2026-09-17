export type NearBuddyMood =
  | "rest"
  | "listening"
  | "excited"
  | "surprised"
  | "doubtful"
  | "angry"
  | "sleepy"
  | "happy"
  | "curious"
  | "confused"
  | "bored"
  | "smug"
  | "shy"
  | "sad"
  | "laugh"
  | "scared"
  | "playful"
  | "working";

/** Faces shown while a reply is streaming — change the eyes, do not bounce the body. */
export const STREAMING_FACE_CYCLE: Exclude<NearBuddyMood, "working">[] = [
  "listening",
  "curious",
  "confused",
  "doubtful",
  "excited",
  "surprised",
  "happy",
  "playful",
];

export function resolveNearBuddyMood(input: {
  streaming?: boolean;
  composerHasText?: boolean;
  composerFocused?: boolean;
}): NearBuddyMood {
  if (input.streaming) return "working";
  if (input.composerHasText) return "listening";
  if (input.composerFocused) return "curious";
  return "rest";
}
