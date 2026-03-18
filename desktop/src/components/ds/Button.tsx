import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-cyan-400 text-black hover:bg-cyan-300",
  ghost: "border border-border px-3 py-1.5 text-text-muted hover:bg-surface-hover",
  danger: "bg-rose-500 text-white hover:bg-rose-400",
};

export function Button({ className = "", variant = "ghost", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-40 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  );
}
