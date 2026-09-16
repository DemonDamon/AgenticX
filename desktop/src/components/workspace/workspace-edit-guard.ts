import { i18n } from "../../i18n/i18n";
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
  if (input.initialLineRange) return i18n.t("preview.editGuard.lineFocus", { ns: "workspace" });
  if (input.truncated) {
    return i18n.t("preview.editGuard.truncated", { ns: "workspace" });
  }
  if (input.content.includes("\uFFFD")) {
    return i18n.t("preview.editGuard.notUtf8", { ns: "workspace" });
  }
  if (input.size > WRITE_LOCAL_TEXT_MAX_BYTES) {
    return i18n.t("preview.editGuard.oversize", { ns: "workspace" });
  }
  return null;
}
