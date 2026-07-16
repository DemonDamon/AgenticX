import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/mcp-proxy-store";
import * as postgresql from "./db-stores/postgresql/mcp-proxy-store";

export type * from "./db-stores/postgresql/mcp-proxy-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listMcpProxyServers: typeof postgresql.listMcpProxyServers = (...args: Parameters<typeof postgresql.listMcpProxyServers>) =>
  implementation().listMcpProxyServers(...args);

export const listMcpProxyServersInternal: typeof postgresql.listMcpProxyServersInternal = (...args: Parameters<typeof postgresql.listMcpProxyServersInternal>) =>
  implementation().listMcpProxyServersInternal(...args);

export const getMcpProxyServer: typeof postgresql.getMcpProxyServer = (...args: Parameters<typeof postgresql.getMcpProxyServer>) =>
  implementation().getMcpProxyServer(...args);

export const createMcpProxyServer: typeof postgresql.createMcpProxyServer = (...args: Parameters<typeof postgresql.createMcpProxyServer>) =>
  implementation().createMcpProxyServer(...args);

export const updateMcpProxyServer: typeof postgresql.updateMcpProxyServer = (...args: Parameters<typeof postgresql.updateMcpProxyServer>) =>
  implementation().updateMcpProxyServer(...args);

export const deleteMcpProxyServer: typeof postgresql.deleteMcpProxyServer = (...args: Parameters<typeof postgresql.deleteMcpProxyServer>) =>
  implementation().deleteMcpProxyServer(...args);
