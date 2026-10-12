export function isPeerHumanSpeakerId(senderId: string | undefined | null): boolean {
  const id = String(senderId ?? "").trim();
  return id.startsWith("human:");
}

export function resolveUserBubbleName(args: {
  speakerUserId?: string;
  speakerName?: string;
  fallbackMe: string;
}): string {
  if (isPeerHumanSpeakerId(args.speakerUserId)) {
    const name = String(args.speakerName ?? "").trim();
    if (name) return name;
  }
  return args.fallbackMe;
}
