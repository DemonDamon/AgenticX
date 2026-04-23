export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-3xl font-bold">AgenticX Enterprise · web-portal</h1>
      <p className="text-zinc-600 dark:text-zinc-300">
        W2 已接入登录链路（admin 开号 → portal 登录）。进入 workspace 前需先登录。
      </p>
      <div className="flex items-center gap-3">
        <a
          href="/workspace"
          className="rounded-md bg-[var(--ui-color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          打开 Workspace（需要登录）
        </a>
        <a
          href="/auth"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          打开登录页
        </a>
      </div>
    </main>
  );
}
