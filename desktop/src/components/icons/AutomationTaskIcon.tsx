import { forwardRef } from "react";
import type { SVGProps } from "react";

/** 定时任务闹钟图标：实心圆盘 + 顶部双铃 + 12 点 / 4 点指针，对齐产品参考稿。 */
export const AutomationTaskIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function AutomationTaskIcon({ className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className ? `automation-task-icon ${className}` : "automation-task-icon"}
        aria-hidden
        {...props}
      >
        {/* 左侧铃铛 */}
        <path
          d="M3 6L6 3"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* 右侧铃铛 */}
        <path
          d="M21 6L18 3"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* 表盘 */}
        <circle cx="12" cy="13" r="8" fill="currentColor" />
        {/* 指针：12点和4点方向 */}
        <path
          className="automation-task-icon__hand"
          d="M12 13V8 M12 13l2.5 2.5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  },
);
