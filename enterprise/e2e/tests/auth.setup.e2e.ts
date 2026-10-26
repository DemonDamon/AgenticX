import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

test.setup('admin signs in', { sessions: ['admin'] }, async ({ app, browser, screen, session }) => {
  const admin = credentials.user('admin');

  await app.open('/login');
  await screen.getByLabel('邮箱').fill(admin.username);
  await screen.getByLabel('密码').fill(admin.password);
  await screen.getByRole('button', '登录并进入控制台').tap();

  await expect(browser).toHaveURL(/\/dashboard$/);
  await expect(screen.getByRole('heading', '企业总览')).toBeVisible();

  await session.save('admin');
});
