import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, X } from "lucide-react";
import { i18n } from "../i18n/i18n";
import { type RoomSummary } from "../utils/collab-room-view";
import { CollabRoomConversation } from "./collab/CollabRoomConversation";

type Props = {
  open?: boolean;
  onClose?: () => void;
  variant?: "dialog" | "page";
};

const NOT_LOGGED_IN = "未登录企业账号，无法加载云房间";

function asRoom(raw: unknown): RoomSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    title: typeof item.title === "string" && item.title.trim() ? item.title : i18n.t("collab.unnamedRoom", { ns: "workspace" }),
    member_count: typeof item.member_count === "number" ? item.member_count : 0,
    last_seq: typeof item.last_seq === "number" ? item.last_seq : 0,
  };
}

export function CollabRoomPanel({ open = true, onClose, variant = "dialog" }: Props) {
  const { t } = useTranslation("workspace");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomNonce, setRoomNonce] = useState(0);

  const loadRooms = useCallback(async () => {
    setListBusy(true);
    setListError(null);
    try {
      const res = await window.agenticxDesktop.collabRoomList();
      if (!res.ok) {
        setRooms([]);
        setListError(res.error || i18n.t("collab.unavailable", { ns: "workspace" }));
        return;
      }
      setRooms((res.data?.rooms ?? []).map(asRoom).filter((item): item is RoomSummary => item != null));
    } catch {
      setRooms([]);
      setListError(i18n.t("collab.unavailable", { ns: "workspace" }));
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRooms();
  }, [open, loadRooms]);

  useEffect(() => {
    if (!open || variant === "page" || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, variant]);

  useEffect(() => {
    if (open) return;
    setActiveRoomId(null);
  }, [open]);

  if (!open) return null;

  const notLoggedIn = listError === NOT_LOGGED_IN;
  const isPage = variant === "page";
  const title = isPage ? t("collab.pageTitle") : t("collab.dialogTitle");

  const header = (
    <div
      className={
        isPage
          ? "flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5"
          : "flex items-center justify-between border-b border-border bg-surface-base px-5 py-4"
      }
    >
      <div className={isPage ? "min-w-0" : "flex items-center gap-2"}>
        {isPage ? (
          <>
            <h2 id="agx-collab-rooms-title" className="text-lg font-semibold tracking-tight text-text-strong">
              {title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{t("collab.pageHint")}</p>
          </>
        ) : (
          <>
            <Users className="h-4 w-4 text-text-faint" strokeWidth={1.8} />
            <h2 id="agx-collab-rooms-title" className="text-lg font-semibold tracking-tight text-text-strong">
              {title}
            </h2>
          </>
        )}
      </div>
      {!isPage && onClose ? (
        <button
          type="button"
          className="agx-topbar-btn !h-10 !w-10"
          onClick={onClose}
          aria-label={t("close", { ns: "common" })}
          title={t("close", { ns: "common" })}
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  const body = (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface-base">
        <div className="border-b border-border px-3 py-2 text-xs text-text-faint">{t("collab.roomList")}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {listBusy ? <p className="px-2 py-3 text-sm text-text-faint">{t("collab.loading")}</p> : null}
          {listError ? (
            <div className="space-y-2 px-2 py-3">
              <p className="text-sm text-text-primary">{listError === NOT_LOGGED_IN ? t("collab.notLoggedIn") : listError}</p>
              {notLoggedIn ? (
                <p className="text-xs text-text-faint">{t("collab.loginFirst")}</p>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-border bg-surface-card px-2 py-1 text-xs text-text-strong"
                  onClick={() => void loadRooms()}
                >
                  {t("retry", { ns: "common" })}
                </button>
              )}
            </div>
          ) : null}
          {!listBusy && !listError && rooms.length === 0 ? (
            <p className="px-2 py-3 text-sm leading-relaxed text-text-faint">
              {t("collab.emptyRooms")}
            </p>
          ) : null}
          {rooms.map((item) => {
            const active = item.id === activeRoomId;
            return (
              <button
                key={item.id}
                type="button"
                className={`mb-1 w-full rounded-md px-2.5 py-2 text-left ${
                  active
                    ? "bg-surface-card-strong text-text-strong"
                    : "text-text-primary hover:bg-surface-card"
                }`}
                onClick={() => {
                  setActiveRoomId(item.id);
                  setRoomNonce((nonce) => nonce + 1);
                }}
              >
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="mt-0.5 text-[11px] text-text-faint">{t("collab.memberCount", { count: item.member_count })}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
        {!activeRoomId ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-faint">
            {t("collab.pickRoom")}
          </div>
        ) : (
          <CollabRoomConversation
            roomId={activeRoomId}
            reloadToken={roomNonce}
            onMemberCount={(count) => {
              setRooms((list) =>
                list.map((item) => (item.id === activeRoomId ? { ...item, member_count: count } : item)),
              );
            }}
            onRevoked={() => {
              setRooms((list) => list.filter((item) => item.id !== activeRoomId));
            }}
            onBack={() => setActiveRoomId(null)}
          />
        )}
      </section>
    </div>
  );

  if (isPage) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base"
        aria-labelledby="agx-collab-rooms-title"
      >
        {header}
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/88 px-3 py-6 backdrop-blur-md">
      <div
        className="relative flex h-[min(85vh,720px)] w-full max-w-[960px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-collab-rooms-title"
      >
        {header}
        {body}
      </div>
    </div>
  );
}
