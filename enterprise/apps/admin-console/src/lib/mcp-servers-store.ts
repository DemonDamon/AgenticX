import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/mcp-servers-store";
import * as postgresql from "./db-stores/postgresql/mcp-servers-store";

export type * from "./db-stores/postgresql/mcp-servers-store";
export { previewOpenAPIOperations } from "./db-stores/postgresql/mcp-servers-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listMcpServers: typeof postgresql.listMcpServers = (...args: Parameters<typeof postgresql.listMcpServers>) =>
  implementation().listMcpServers(...args);

export const getMcpServer: typeof postgresql.getMcpServer = (...args: Parameters<typeof postgresql.getMcpServer>) =>
  implementation().getMcpServer(...args);

export const createMcpServer: typeof postgresql.createMcpServer = (...args: Parameters<typeof postgresql.createMcpServer>) =>
  implementation().createMcpServer(...args);

export const updateMcpServer: typeof postgresql.updateMcpServer = (...args: Parameters<typeof postgresql.updateMcpServer>) =>
  implementation().updateMcpServer(...args);

export const deleteMcpServer: typeof postgresql.deleteMcpServer = (...args: Parameters<typeof postgresql.deleteMcpServer>) =>
  implementation().deleteMcpServer(...args);

export const listMcpTools: typeof postgresql.listMcpTools = (...args: Parameters<typeof postgresql.listMcpTools>) =>
  implementation().listMcpTools(...args);

export const replaceMcpTools: typeof postgresql.replaceMcpTools = (...args: Parameters<typeof postgresql.replaceMcpTools>) =>
  implementation().replaceMcpTools(...args);

export const getMcpServerHealth: typeof postgresql.getMcpServerHealth = (...args: Parameters<typeof postgresql.getMcpServerHealth>) =>
  implementation().getMcpServerHealth(...args);

export const importOpenAPITools: typeof postgresql.importOpenAPITools = (...args: Parameters<typeof postgresql.importOpenAPITools>) =>
  implementation().importOpenAPITools(...args);
