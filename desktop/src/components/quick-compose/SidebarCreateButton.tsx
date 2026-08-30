import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Hash, Plus } from "lucide-react";
import { useAppStore } from "../../store";
import { HoverTip } from "../ds/HoverTip";

const MENU_WIDTH = 168;

export function SidebarCreateButton() {
  const openQuickCompose = useAppStore((s) => s.openQuickCompose);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - MENU_WIDTH),
      });
    }
    setMenuOpen((v) => !v);
  };

  const pick = (intent: "expert" | "group") => {
    setMenuOpen(false);
    openQuickCompose(intent);
  };

  const menu =
    menuOpen && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-quick-compose-trigger=""
            className="z-[200] overflow-hidden rounded-xl bg-surface-base p-1 shadow-xl"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition-colors hover:bg-surface-hover"
              onClick={() => pick("expert")}
            >
              <Bot className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} aria-hidden />
              新建专家
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition-colors hover:bg-surface-hover"
              onClick={() => pick("group")}
            >
              <Hash className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} aria-hidden />
              新建群聊
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <HoverTip label="新建">
        <button
          ref={btnRef}
          type="button"
          className="agx-topbar-btn agx-topbar-btn--icon-only"
          aria-label="新建"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          data-quick-compose-trigger=""
          onClick={openMenu}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </HoverTip>
      {menu}
    </>
  );
}
