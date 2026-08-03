"use client";

import * as React from "react";
import type { ChatMessage } from "@agenticx/core-api";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agenticx/ui";
import { Image, Link2, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyText } from "../../lib/chat-share-client";
import {
  expandChatShareSelection,
  toChatShareMessage,
  type ChatShareMessage,
} from "../../lib/chat-share-types";

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  messages: ChatMessage[];
  initialSelectedIds: string[];
  onCreateLink: (messageIds: string[]) => Promise<string>;
  onGenerateImage: (messages: ChatShareMessage[]) => Promise<void>;
};

export function ShareDialog({
  open,
  onOpenChange,
  title,
  messages,
  initialSelectedIds,
  onCreateLink,
  onGenerateImage,
}: ShareDialogProps) {
  const t = useTranslations("chat");
  const shareMessages = React.useMemo(
    () => messages.map(toChatShareMessage).filter((message): message is ChatShareMessage => message !== null),
    [messages],
  );
  const shareMessageIds = React.useMemo(() => shareMessages.map((message) => message.id), [shareMessages]);
  const initialIdsKey = initialSelectedIds.join(",");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState<"link" | "image" | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const imageRequestInFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const validIds = new Set(shareMessageIds);
    const requested = initialSelectedIds.filter((id) => validIds.has(id));
    setSelected(new Set(requested.length > 0 ? requested : shareMessageIds));
    setStatus(null);
    setBusy(null);
  }, [open, initialIdsKey, shareMessageIds, initialSelectedIds]);

  const allSelected = shareMessages.length > 0 && selected.size === shareMessages.length;
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStatus(null);
  };

  const runCreateLink = async () => {
    if (selected.size === 0) {
      setStatus(t("shareNoSelection"));
      return;
    }
    setBusy("link");
    setStatus(null);
    try {
      const url = await onCreateLink([...selected]);
      await copyText(url);
      setStatus(t("shareLinkCopied"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  };

  const runGenerateImage = async () => {
    if (selected.size === 0) {
      setStatus(t("shareNoSelection"));
      return;
    }
    if (imageRequestInFlightRef.current) return;
    imageRequestInFlightRef.current = true;
    setBusy("image");
    setStatus(null);
    try {
      await onGenerateImage(expandChatShareSelection(shareMessages, selected));
      setStatus(t("shareImageReady"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("shareFailed"));
    } finally {
      setBusy(null);
      imageRequestInFlightRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-5">
        <DialogHeader>
          <DialogTitle>{t("shareDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("shareDialogDescription", { title })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            {t("shareSelectedCount", { count: selected.size })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(allSelected ? [] : shareMessageIds))}
            disabled={shareMessages.length === 0}
          >
            {allSelected ? t("shareClearSelection") : t("shareSelectAll")}
          </Button>
        </div>

        <div className="max-h-[min(52vh,30rem)] overflow-y-auto rounded-xl border border-border/70 p-2">
          {shareMessages.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("shareNoMessages")}</p>
          ) : (
            <div className="space-y-1.5">
              {shareMessages.map((message) => (
                <label
                  key={message.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selected.has(message.id)}
                    onCheckedChange={() => toggle(message.id)}
                    className="mt-0.5"
                    aria-label={message.role === "user" ? t("shareUserMessage") : t("shareAssistantMessage")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                      {message.role === "user" ? t("shareUserMessage") : t("shareAssistantMessage")}
                    </span>
                    <span className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                      {message.content}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {status}
        </div>
        <DialogFooter className="sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">{t("shareSnapshotHint")}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void runGenerateImage()} disabled={busy !== null || selected.size === 0}>
              <Image className="h-4 w-4" />
              {t("shareGenerateImage")}
            </Button>
            <Button type="button" onClick={() => void runCreateLink()} disabled={busy !== null || selected.size === 0}>
              <Link2 className="h-4 w-4" />
              {busy === "link" ? t("sharing") : t("shareCopyLink")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
