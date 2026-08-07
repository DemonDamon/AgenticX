export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.on("unhandledRejection", (reason) => {
    console.error("[portal] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    // 记录后交回默认行为（不吞），由编排器重启，避免带病进程继续服务。
    console.error("[portal] uncaughtException:", error);
  });
}
