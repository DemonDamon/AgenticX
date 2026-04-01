import type { ReactNode } from "react";

type Props = {
  prefix?: ReactNode;
  className?: string;
  variant?: "topbar" | "list";
};

export function FeishuBadge({ prefix, className = "", variant = "list" }: Props) {
  const base = "text-[#3370FF]";
  const style = { backgroundColor: "rgba(51,112,255,0.15)" };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium leading-tight ${base} ${className}`.trim()}
      style={style}
    >
      {prefix}
      飞书
    </span>
  );
}
