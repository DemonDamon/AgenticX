/** Local video files: frontend cannot parse; backend `video_understand` handles via absolute path. */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const lower = file.name.toLowerCase();
  return [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"].some((ext) => lower.endsWith(ext));
}
