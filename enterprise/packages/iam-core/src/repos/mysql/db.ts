import { resolveDatabaseConfig } from "../../database/config";
import {
  createMysqlDb,
  getMysqlDrizzle,
  type MySqlDrizzleDb,
} from "../../database/mysql";

export async function getMysqlRepositoryDb(): Promise<MySqlDrizzleDb> {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "mysql") {
    throw new Error(`MySQL repository requested for dialect=${config.dialect}`);
  }
  return getMysqlDrizzle(await createMysqlDb(config));
}
