/** 仅触控设备启用长按多选；桌面鼠标用于拖选文字，不应触发长按。 */
export function shouldStartLongPress(pointerType: string): boolean {
  return pointerType === "touch";
}

export function shouldCancelLongPressOnMove(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx = 8,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > thresholdPx;
}

export function hasActiveTextSelection(selectionText?: string | null): boolean {
  return Boolean(selectionText?.trim());
}
