/** webpack 开发态不要预取这些重页，否则一悬停就整站卡死。 */
export const HEAVY_DEV_PREFETCH_HREFS = new Set(["/portal-logs"]);

/** 保留常量供既有调用对齐；webpack 下 hover prefetch 已关闭。 */
export const ADMIN_NAV_HOVER_PREFETCH_MS = 600;

/**
 * webpack 的 Compiling 会占住 next-server。hover/prefetch 只会在点击前
 * 再插一串编译，侧栏扫过时整站假死。开发态一律不预取。
 */
export function shouldHoverPrefetchAdminNav({
  href,
  pathname,
  navPrefetchEnabled,
}: {
  href: string;
  pathname: string;
  navPrefetchEnabled: boolean;
}): boolean {
  void href;
  void pathname;
  void navPrefetchEnabled;
  return false;
}
