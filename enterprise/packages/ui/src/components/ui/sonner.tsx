"use client";

import { Toaster as SonnerToaster, toast, type ToasterProps } from "sonner";
import { useUiTheme } from "../../branding/useUiTheme";

/**
 * Toaster · 基于 sonner 的全局 toast 出口
 *
 * 使用：
 *   1. 在 App 根部放 <Toaster /> 一次
 *   2. 业务代码里 toast("成功"), toast.error("失败"), toast.promise(fn, {...}) 直接调
 *
 * 主题自动跟随 useUiTheme（system/dark/light）
 */
export function Toaster(props: ToasterProps) {
  const { resolved } = useUiTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast !border !border-border !bg-popover !text-popover-foreground !shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { toast };
