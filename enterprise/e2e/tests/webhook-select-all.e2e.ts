import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('selects every webhook event, then clears them, then mixes one group', { session: 'admin' }, async ({
  app,
  screen,
}) => {
  await app.open('/admin/agent-webhooks');
  await expect(screen.getByRole('heading', 'Webhook 通知', { level: 1 })).toBeVisible();

  await screen.getByRole('button', '新建 Webhook').tap();
  await expect(screen.getByRole('heading', '新建 Webhook 端点')).toBeVisible();
  await expect(screen.getByText('已选择 0 / 29 个事件类型')).toBeVisible();

  await screen.getByRole('checkbox', '全选').check();
  await expect(screen.getByText('已选择 29 / 29 个事件类型')).toBeVisible();

  await screen.getByRole('checkbox', '全选').uncheck();
  await expect(screen.getByText('已选择 0 / 29 个事件类型')).toBeVisible();

  await screen.getByRole('checkbox', '智能体开始执行').check();
  await expect(screen.getByRole('checkbox', '会话')).toHaveAttribute('aria-checked', 'mixed');

  await screen.getByRole('button', '取消').tap();
  await expect(screen.getByRole('heading', '新建 Webhook 端点')).toBeHidden();
});
