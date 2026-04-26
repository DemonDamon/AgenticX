import * as React from "react";
import { cn } from "@agenticx/ui";

type ModelSelectorProps = {
  value: string;
  options: string[];
  onChange: (model: string) => void;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  icons?: Record<string, React.ReactNode>;
  placement?: "top" | "bottom";
  align?: "start" | "end";
};

export function ModelSelector({
  value,
  options,
  onChange,
  labels,
  descriptions,
  icons,
  placement = "top",
  align = "end",
}: ModelSelectorProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const selectedLabel = labels?.[value] ?? value;
  const selectedDescription = descriptions?.[value];
  const selectedIcon = icons?.[value];

  return (
    <div ref={rootRef} className="relative w-[240px] max-w-full">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-10 w-full items-center gap-2 rounded-full border border-border/70 bg-card px-3 text-left shadow-sm transition-colors hover:border-border hover:bg-background"
      >
        {selectedIcon ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-primary">{selectedIcon}</span>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{selectedLabel}</span>
        <span className={cn("shrink-0 text-xs text-muted-foreground transition-transform", open && "rotate-180")}>▾</span>
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-[min(calc(100vw-2rem),360px)] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur",
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "start" ? "left-0" : "right-0"
          )}
        >
          {options.map((model) => {
            const isSelected = model === value;
            const optionLabel = labels?.[model] ?? model;
            const optionDescription = descriptions?.[model];
            const optionIcon = icons?.[model];

            return (
              <button
                key={model}
                type="button"
                onClick={() => {
                  onChange(model);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  isSelected ? "bg-primary-soft/70" : "hover:bg-muted/70"
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 text-primary">
                  {optionIcon ?? <span className="text-xs text-muted-foreground">•</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold leading-6 text-foreground">{optionLabel}</span>
                  {optionDescription ? (
                    <span className="block truncate text-sm leading-5 text-muted-foreground">{optionDescription}</span>
                  ) : null}
                </span>
                <span className={cn("pt-1 text-base text-primary", !isSelected && "opacity-0")}>✓</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

