export type ChannelToggle = {
  enabled: boolean;
  appSecret: string;
  botToken: string;
  signingSecret: string;
  webhookSecret: string;
  appId: string;
};

export type GatewayAdapterForm = {
  dingtalk: Pick<ChannelToggle, "enabled" | "appSecret">;
  slack: Pick<ChannelToggle, "enabled" | "botToken" | "signingSecret">;
  telegram: Pick<ChannelToggle, "enabled" | "botToken" | "webhookSecret">;
  qqbot: Pick<ChannelToggle, "enabled" | "appId" | "appSecret">;
};

export function emptyGatewayAdapterForm(): GatewayAdapterForm {
  return {
    dingtalk: { enabled: false, appSecret: "" },
    slack: { enabled: false, botToken: "", signingSecret: "" },
    telegram: { enabled: false, botToken: "", webhookSecret: "" },
    qqbot: { enabled: false, appId: "", appSecret: "" },
  };
}

type YamlConfig = {
  gateway?: Record<string, unknown> & {
    adapters?: Record<string, Record<string, unknown>>;
  };
};

export function mergeGatewayAdapters<T extends YamlConfig>(cfg: T, form: GatewayAdapterForm): T {
  const gateway = { ...(cfg.gateway ?? {}) };
  const adapters = { ...(gateway.adapters ?? {}) };
  adapters.dingtalk = {
    enabled: form.dingtalk.enabled,
    app_secret: form.dingtalk.appSecret.trim(),
  };
  adapters.slack = {
    enabled: form.slack.enabled,
    bot_token: form.slack.botToken.trim(),
    signing_secret: form.slack.signingSecret.trim(),
  };
  adapters.telegram = {
    enabled: form.telegram.enabled,
    bot_token: form.telegram.botToken.trim(),
    webhook_secret: form.telegram.webhookSecret.trim(),
  };
  adapters.qqbot = {
    enabled: form.qqbot.enabled,
    app_id: form.qqbot.appId.trim(),
    app_secret: form.qqbot.appSecret.trim(),
  };
  gateway.adapters = adapters;
  return { ...cfg, gateway };
}

export function readGatewayAdapterForm(cfg: YamlConfig): GatewayAdapterForm {
  const adapters = cfg.gateway?.adapters ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const flag = (value: unknown) => value === true;
  const dingtalk = adapters.dingtalk ?? {};
  const slack = adapters.slack ?? {};
  const telegram = adapters.telegram ?? {};
  const qqbot = adapters.qqbot ?? {};
  return {
    dingtalk: { enabled: flag(dingtalk.enabled), appSecret: text(dingtalk.app_secret) },
    slack: {
      enabled: flag(slack.enabled),
      botToken: text(slack.bot_token),
      signingSecret: text(slack.signing_secret),
    },
    telegram: {
      enabled: flag(telegram.enabled),
      botToken: text(telegram.bot_token),
      webhookSecret: text(telegram.webhook_secret),
    },
    qqbot: {
      enabled: flag(qqbot.enabled),
      appId: text(qqbot.app_id),
      appSecret: text(qqbot.app_secret),
    },
  };
}
