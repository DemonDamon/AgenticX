import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/gateway-channels-store";
import * as postgresql from "./db-stores/postgresql/gateway-channels-store";

export type * from "./db-stores/postgresql/gateway-channels-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listChannels: typeof postgresql.listChannels = (...args: Parameters<typeof postgresql.listChannels>) =>
  implementation().listChannels(...args);

export const listChannelsInternal: typeof postgresql.listChannelsInternal = (...args: Parameters<typeof postgresql.listChannelsInternal>) =>
  implementation().listChannelsInternal(...args);

export const createChannel: typeof postgresql.createChannel = (...args: Parameters<typeof postgresql.createChannel>) =>
  implementation().createChannel(...args);

export const updateChannel: typeof postgresql.updateChannel = (...args: Parameters<typeof postgresql.updateChannel>) =>
  implementation().updateChannel(...args);

export const deleteChannel: typeof postgresql.deleteChannel = (...args: Parameters<typeof postgresql.deleteChannel>) =>
  implementation().deleteChannel(...args);

export const fetchGatewayKeypoolStats: typeof postgresql.fetchGatewayKeypoolStats = (...args: Parameters<typeof postgresql.fetchGatewayKeypoolStats>) =>
  implementation().fetchGatewayKeypoolStats(...args);

export const resetGatewayKeypoolCooldown: typeof postgresql.resetGatewayKeypoolCooldown = (...args: Parameters<typeof postgresql.resetGatewayKeypoolCooldown>) =>
  implementation().resetGatewayKeypoolCooldown(...args);

export const fetchGatewayChannelStats: typeof postgresql.fetchGatewayChannelStats = (...args: Parameters<typeof postgresql.fetchGatewayChannelStats>) =>
  implementation().fetchGatewayChannelStats(...args);
