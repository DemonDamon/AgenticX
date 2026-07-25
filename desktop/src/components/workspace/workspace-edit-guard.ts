import { WRITE_LOCAL_TEXT_MAX_BYTES } from "./workspace-edit-limits";
import type { WorkspacePreviewLineRange } from "./workspace-preview-types";

export type EditGuardInput = {
  hasTextualPreview: boolean;
  truncated: boolean;
  content: string;
  size: number;
  initialLineRange?: WorkspacePreviewLineRange | null;
};

/**
 * Returns a user-facing reason why editing is blocked, or null if editable.
 * Non-textual previews return null (caller hides the edit entry entirely).
 */
export function getEditBlockReason(input: EditGuardInput): string | null {
  if (!input.hasTextualPreview) return null;
  if (input.initialLineRange) return "行号聚焦模式下不可编辑";
  if (input.truncated) {
    return "文件过大已截断，为避免覆盖丢失内容，暂不可编辑";
  }
  if (input.content.includes("\uFFFD")) {
    return "文件疑似非 UTF-8 编码，暂不可编辑";
  }
  if (input.size > WRITE_LOCAL_TEXT_MAX_BYTES) {
    return "文件超过 512 KB 写入上限";
  }
  return null;
}
