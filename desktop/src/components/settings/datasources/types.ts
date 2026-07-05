export type DataSourceStatus =
  | "ready"
  | "missing_credential"
  | "mcp_disconnected"
  | "disabled"
  | "unavailable";

export interface DataSourceApiInfo {
  name: string;
  description: string;
}

export interface DataSourceInfo {
  name: string;
  displayName: string;
  domain: string;
  requiresCredential: boolean;
  status: DataSourceStatus;
  enabled: boolean;
  stubOnly?: boolean;
  mcpServer?: string;
  mcpConnected?: boolean;
  apis?: DataSourceApiInfo[];
}

export interface DataSourceConfigPatch {
  enabled?: boolean;
  token?: string;
}
