import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to load e2e.config.ts`);
  }
  return value;
}

const model = createOpenAICompatible({
  name: 'e2e-model',
  baseURL: requiredEnv('E2E_MODEL_BASE_URL'),
  apiKey: requiredEnv('E2E_MODEL_API_KEY'),
  supportsStructuredOutputs: false,
});

export default {
  agents: {
    default: {
      model: model.chatModel(requiredEnv('E2E_MODEL_ID')),
    },
  },
  targets: [
    {
      engine: web({
        locale: 'zh-CN',
        viewport: { width: 1440, height: 900 },
      }),
      app: {
        url: process.env.ADMIN_URL ?? 'http://localhost:3001',
      },
    },
  ],
  credentials: {
    admin: {
      username: process.env.ADMIN_EMAIL ?? process.env.ADMIN_CONSOLE_LOGIN_EMAIL ?? 'admin@agenticx.local',
      password: requiredEnv('ADMIN_CONSOLE_LOGIN_PASSWORD'),
    },
  },
  timeout: 180_000,
  assertionTimeout: 20_000,
  workers: 1,
  video: 'retain-on-failure',
} satisfies E2EConfig;
