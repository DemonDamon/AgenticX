import { cn } from "@agenticx/ui";
import Image from "next/image";

export const ENTERPRISE_PRODUCT_NAME = "和创智派";
export const ENTERPRISE_LOGO_SRC = "/hechuang-zhihui-logo.svg";

export function EnterpriseBrandMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={ENTERPRISE_LOGO_SRC}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain drop-shadow-[0_3px_8px_rgba(14,132,197,0.2)]"
        unoptimized
        priority
      />
    </span>
  );
}
