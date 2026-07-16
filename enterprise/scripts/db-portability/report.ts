import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TableReport = {
  table: string;
  sourceCount: number;
  targetCount: number;
  sourceChecksum: string;
  targetChecksum: string;
  ok: boolean;
  checkpointPk?: string | null;
};

export type MigrationReport = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  tables: TableReport[];
  ok: boolean;
};

export function writeReport(path: string, report: MigrationReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
}
