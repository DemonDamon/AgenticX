import { resolveDatabaseConfig } from "../../database/config";
import { getTenantIamTransaction } from "../../database/tenant-iam-transaction";
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
  return (getTenantIamTransaction("mysql") as MySqlDrizzleDb | null) ?? getMysqlDrizzle(await createMysqlDb(config));
}
