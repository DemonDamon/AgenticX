/**
 * W4 skeleton — safe-query NL2SQL path (explain → execute → write-gate denial).
 * Full copper-pipe case polish is W6. Requires admin session + ADMIN_URL.
 *
 * Manual fallback (no e2e harness):
 * 1. Open /admin/data-nl2sql
 * 2. Keep default 华东零售问句, mode「讲解」→ 运行 → see SQL draft, no rows
 * 3. Switch「执行」→ 运行 → see result rows
 * 4. Click「填入写闸演示」→ 运行 → see 写闸已拒绝
 * 5. Knowledge: publish object →「查看邻域」→ /admin/graph-explorer?focus=…
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test(
  'safe-query: explain then execute on data-nl2sql',
  { session: 'admin' },
  async ({ app, browser, screen }) => {
    await app.open('/admin/data-nl2sql');
    await expect(browser).toHaveURL(/\/admin\/data-nl2sql$/);
    await expect(screen.getByTestId('data-nl2sql-page')).toBeVisible();
    await expect(screen.getByRole('heading', '安全问数', { level: 1 })).toBeVisible();

    await screen.getByTestId('data-nl2sql-mode-explain').tap();
    await screen.getByTestId('data-nl2sql-run').tap();
    await expect(screen.getByTestId('data-nl2sql-result')).toBeVisible();
    await expect(screen.getByTestId('data-nl2sql-sql')).toContainText(/SELECT/i);
    await expect(screen.getByTestId('data-nl2sql-explain-note')).toBeVisible();

    await screen.getByTestId('data-nl2sql-mode-execute').tap();
    await screen.getByTestId('data-nl2sql-run').tap();
    await expect(screen.getByTestId('data-nl2sql-rows')).toBeVisible();
    await expect(screen.getByTestId('data-nl2sql-rows')).toContainText('华东');
  },
);

test(
  'safe-query: write-gate denial is visible in Chinese',
  { session: 'admin' },
  async ({ app, browser, screen }) => {
    await app.open('/admin/data-nl2sql');
    await expect(browser).toHaveURL(/\/admin\/data-nl2sql$/);
    await screen.getByTestId('data-nl2sql-demo-deny').tap();
    await screen.getByTestId('data-nl2sql-run').tap();
    await expect(screen.getByTestId('data-nl2sql-denial')).toBeVisible();
    await expect(screen.getByTestId('data-nl2sql-denial-reason')).toContainText('写闸已拒绝');
  },
);

test(
  'safe-query: knowledge published object links to neighborhood',
  { session: 'admin' },
  async ({ app, browser, screen }) => {
    await app.open('/admin/knowledge-lifecycle');
    await expect(browser).toHaveURL(/\/admin\/knowledge-lifecycle$/);
    await expect(screen.getByTestId('knowledge-lifecycle-page')).toBeVisible();
    // W6 will drive draft→review→published; skeleton only asserts page + optional hook when published.
    const neighborhood = screen.getByTestId('knowledge-lifecycle-view-neighborhood');
    const count = await neighborhood.count();
    if (count > 0) {
      await neighborhood.first().tap();
      await expect(browser).toHaveURL(/\/admin\/graph-explorer\?focus=/);
      await expect(screen.getByTestId('graph-explorer-page')).toBeVisible();
    } else {
      // No published object in seed yet — path documented for W6 copper pipe.
      await expect(screen.getByTestId('knowledge-lifecycle-list')).toBeVisible();
    }
  },
);
