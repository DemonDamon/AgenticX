import { resolveDatabaseConfig } from "@agenticx/iam-core";

import * as mysql from "./db-stores/mysql/desktop-agent-policy-store";
import * as postgresql from "./db-stores/postgresql/desktop-agent-policy-store";

export type * from "./db-stores/postgresql/desktop-agent-policy-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const getDesktopAgentPolicy: typeof postgresql.getDesktopAgentPolicy = (
  ...args: Parameters<typeof postgresql.getDesktopAgentPolicy>
) => implementation().getDesktopAgentPolicy(...args);

export const setDesktopAgentPolicy: typeof postgresql.setDesktopAgentPolicy = (
  ...args: Parameters<typeof postgresql.setDesktopAgentPolicy>
) => implementation().setDesktopAgentPolicy(...args);
