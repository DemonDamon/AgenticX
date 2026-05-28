import { ChevronsDown } from "lucide-react";

type Props = {
  text: string;
};

/** Flat, non-expandable context/token budget notice — aligned with TurnToolGroupCard check row. */
export function ContextNoticeLine({ text }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1 text-[13px] text-text-muted">
      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
          style={{
            backgroundColor: "rgba(var(--theme-color-rgb, 59, 130, 246), 0.14)",
            boxShadow: "inset 0 0 0 1px rgba(var(--theme-color-rgb, 59, 130, 246), 0.34)",
            color: "rgb(var(--theme-color-rgb, 59, 130, 246))",
          }}
        >
          <ChevronsDown className="h-[11px] w-[11px]" strokeWidth={2.2} />
        </span>
      </span>
      <span className="min-w-0 break-words leading-[1.65]">{text}</span>
    </div>
  );
}
