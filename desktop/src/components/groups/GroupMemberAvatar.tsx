import {
  BookOpen,
  Bot,
  Boxes,
  Bug,
  ClipboardList,
  FileSearch,
  FolderKanban,
  LineChart,
  Newspaper,
  PackageCheck,
  Search,
  Sparkles,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Avatar } from "../../store";
import { avatarBgClass, avatarFgClass } from "../../utils/avatar-color";

type Props = {
  avatar?: Pick<Avatar, "id" | "name" | "avatarUrl" | "color">;
  label?: string;
  /** Used for stable fallback selection when the avatar record is stale. */
  identity?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

const MEMBER_ICON_SET: LucideIcon[] = [
  Bot,
  Sparkles,
  Search,
  Wrench,
  FileSearch,
  BookOpen,
  LineChart,
  ClipboardList,
  PackageCheck,
  Boxes,
  Bug,
  Newspaper,
];

const GROUP_ICON_SET: LucideIcon[] = [UsersRound, Bot, FolderKanban, Boxes, Sparkles, ClipboardList];

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  xs: "h-6 w-6 rounded-lg",
  sm: "h-8 w-8 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-12 w-12 rounded-[14px]",
};

const ICON_SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-[18px] w-[18px]",
  lg: "h-5 w-5",
};

function stableIndex(identity: string, length: number): number {
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % length;
}

function resolveMemberIcon(identity: string): LucideIcon {
  return MEMBER_ICON_SET[stableIndex(identity, MEMBER_ICON_SET.length)] ?? Bot;
}

function resolveGroupIcon(identity: string): LucideIcon {
  return GROUP_ICON_SET[stableIndex(identity, GROUP_ICON_SET.length)] ?? UsersRound;
}

/** Consistent member identity: real image first, then a stable robot/tool icon. */
export function GroupMemberAvatar({
  avatar,
  label,
  identity,
  size = "md",
  className = "",
}: Props) {
  const displayName = String(avatar?.name || label || "成员").trim() || "成员";
  const stableIdentity = String(identity || avatar?.id || displayName);
  const sizeClass = SIZE_CLASS[size];
  const imageUrl = String(avatar?.avatarUrl || "").trim();

  if (imageUrl) {
    return <img src={imageUrl} alt="" className={`${sizeClass} shrink-0 object-cover ${className}`} />;
  }

  const Icon = resolveMemberIcon(stableIdentity);
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${sizeClass} ${avatarBgClass(avatar?.color)} ${avatarFgClass(avatar?.color)} ${className}`}
      aria-label={`${displayName} 默认图标`}
    >
      <Icon className={ICON_SIZE_CLASS[size]} strokeWidth={1.8} aria-hidden />
    </div>
  );
}

/** Group identity mark; groups never fall back to a text monogram. */
export function GroupIdentityIcon({
  identity,
  iconBg,
  size = "lg",
  className = "",
}: {
  identity: string;
  iconBg?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = resolveGroupIcon(identity);
  const sizeClass = size === "sm" ? "h-8 w-8 rounded-lg" : size === "md" ? "h-10 w-10 rounded-xl" : SIZE_CLASS.lg;
  const iconClass = size === "sm" ? "h-4 w-4" : size === "md" ? "h-[18px] w-[18px]" : ICON_SIZE_CLASS.lg;

  return (
    <div
      className={`flex shrink-0 items-center justify-center text-white ${sizeClass} ${className}`}
      style={{ backgroundColor: iconBg || "var(--surface-card-strong)" }}
      aria-hidden
    >
      <Icon className={iconClass} strokeWidth={1.8} />
    </div>
  );
}
