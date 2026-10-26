import { test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';

import { adminRequest, assertOk } from '../support/admin-api.ts';
import { eventData, startReceiver, type WebhookReceiver } from '../support/webhook-receiver.ts';

const DESCRIPTION = 'e2e 订阅执行环境事件';
const created = {
  envId: '',
  webhookId: '',
  receiver: null as WebhookReceiver | null,
};

test.afterEach(async ({ app, browser }) => {
  const cookies = await browser.cookies();
  if (created.webhookId) {
    const removed = await adminRequest(app.baseUrl, cookies, `/api/admin/ma-webhooks/${created.webhookId}`, {
      method: 'DELETE',
    });
    if (removed.status >= 400 && removed.status !== 404) {
      throw new Error(`delete webhook failed: HTTP ${removed.status} code ${removed.body.code ?? 'none'}`);
    }
    created.webhookId = '';
    // The runtime caches webhook configs for 2s; deleting the environment sooner would still notify this endpoint.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (created.envId) {
    const removed = await adminRequest(app.baseUrl, cookies, `/api/admin/ma-environments/${created.envId}`, {
      method: 'DELETE',
    });
    if (removed.status >= 400 && removed.status !== 404) {
      throw new Error(`delete environment failed: HTTP ${removed.status} code ${removed.body.code ?? 'none'}`);
    }
    created.envId = '';
  }
  if (created.receiver) {
    await created.receiver.close();
    created.receiver = null;
  }
});

test('subscribes to environment events and receives environment.created', { session: 'admin' }, async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const receiver = await startReceiver();
  created.receiver = receiver;
  const hookName = unique(`e2e-hook-${Date.now()}`);

  await app.open('/dashboard');
  await expect(screen.getByText('资源配置')).toBeVisible();
  await screen.getByRole('link', 'Webhook 通知').tap();
  await expect(browser).toHaveURL(/\/admin\/agent-webhooks$/);
  await expect(screen.getByRole('heading', 'Webhook 通知', { level: 1 })).toBeVisible();

  await screen.getByRole('button', '新建 Webhook').tap();
  await expect(screen.getByRole('heading', '新建 Webhook 端点')).toBeVisible();
  await screen.getByLabel('端点 URL').fill(receiver.url);
  await screen.getByLabel('名称').fill(hookName.value);
  await screen.getByLabel('描述（可选）').fill(DESCRIPTION);

  await agent.act('在事件类型里只勾选「执行环境」分组下的全部事件');
  await expect(screen.getByText('已选择 3 / 29 个事件类型')).toBeVisible();
  const environmentGroup = screen.getByRole('group', '执行环境');
  await expect(environmentGroup.getByText('3 / 3')).toBeVisible();

  await screen.getByRole('button', '新建 Webhook 端点').tap();
  await expect(screen.getByRole('heading', '签名密钥')).toBeVisible();
  const secret = (await screen.getByText(/^whsec_/).textContent())?.trim() ?? '';
  if (!secret.startsWith('whsec_')) {
    throw new Error('signing secret dialog did not show a whsec_ secret');
  }
  receiver.setSecret(secret);
  await screen.getByRole('button', '关闭').tap();

  const row = screen.getByRole('row').filter({ hasText: hookName.value });
  await expect(row).toContainText(hookName.value);
  await expect(row).toContainText(DESCRIPTION);

  const cookies = await browser.cookies();
  const listed = await adminRequest(app.baseUrl, cookies, '/api/admin/ma-webhooks');
  assertOk(listed, 'list webhooks');
  const webhooks = (listed.body.data as { webhooks?: { id: string; name: string }[] } | undefined)?.webhooks ?? [];
  const webhook = webhooks.find((item) => item.name === hookName.value);
  if (!webhook) throw new Error('created webhook was not listed');
  created.webhookId = webhook.id;

  // Runtime webhook config cache TTL is 2s. Wait so the new endpoint is visible before the event is enqueued.
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const envName = `e2e-env-${Date.now()}`;
  const createdEnv = await adminRequest(app.baseUrl, cookies, '/api/admin/ma-environments', {
    method: 'POST',
    body: JSON.stringify({
      name: envName,
      type: 'cloud',
      description: 'e2e cloud environment',
      config: { type: 'cloud' },
    }),
  });
  assertOk(createdEnv, 'create environment');
  const environment = (createdEnv.body.data as { environment?: { id?: string } } | undefined)?.environment;
  if (!environment?.id) throw new Error('create environment returned no id');
  created.envId = environment.id;

  await expect
    .poll(
      () =>
        receiver.received.some((item) => {
          const data = eventData(item);
          return item.verified && data?.type === 'environment.created' && data.resource_id === created.envId;
        }),
      { timeout: 45_000, message: 'signed environment.created webhook was not delivered' },
    )
    .toBe(true);

  await row.getByRole('button', '投递记录').tap();
  await expect(screen.getByRole('heading', '投递记录')).toBeVisible();
  await agent.assert('投递记录里有一条环境已创建的记录，状态是成功');
  await expect(screen.getByRole('cell', 'succeeded')).toBeVisible();
});
