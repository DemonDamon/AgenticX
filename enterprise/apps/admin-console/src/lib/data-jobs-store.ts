/**
 * Admin persistence for DataFlow job ops (H6).
 * Mirrors Python DataJobOpsService semantics for schedule / schedule_run history.
 * Does not call MA agent-schedules; dedicated data-suite jobs surface.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type JobTrigger = "schedule" | "manual" | "backfill" | "replay";
export type JobRunStatus = "running" | "succeeded" | "failed";

export type DataJobRecord = {
  id: string;
  name: string;
  cron: string;
  description: string;
};

export type DataJobScheduleRecord = {
  id: string;
  job_id: string;
  cron: string;
  enabled: boolean;
};

export type DataJobRunRecord = {
  id: string;
  schedule_id: string;
  job_id: string;
  trigger: JobTrigger;
  status: JobRunStatus;
  snapshot_id: string | null;
  error: string | null;
  started_at: string;
  finished_at: string;
  scheduled_for: string | null;
  replay_of_snapshot_id: string | null;
  row_count: number;
  written: number;
};

export type WebhookEventRecord = {
  kind: string;
  payload: Record<string, unknown>;
};

type JobsFile = {
  jobs: DataJobRecord[];
  schedules: DataJobScheduleRecord[];
  runs: DataJobRunRecord[];
  webhook_events: WebhookEventRecord[];
};

export const SAMPLE_GOLDEN_JOB: DataJobRecord = {
  id: "golden_path_members",
  name: "golden_path_members",
  cron: "0 3 * * *",
  description: "黄金路径会员作业（脱敏样例）",
};

export const FAIL_WEBHOOK_KIND = "data_job.run_failed";

function storeDir(): string {
  const env = process.env.AGX_DATA_SUITE_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/data-suite");
}

function jobsPath(): string {
  return path.join(storeDir(), "jobs_ops.json");
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function emptyFile(): JobsFile {
  return { jobs: [], schedules: [], runs: [], webhook_events: [] };
}

async function loadFile(): Promise<JobsFile> {
  const file = jobsPath();
  try {
    await readFile(file, "utf-8");
    const data = await readJsonFile<JobsFile>(file, emptyFile());
    return {
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
      schedules: Array.isArray(data.schedules) ? data.schedules : [],
      runs: Array.isArray(data.runs) ? data.runs : [],
      webhook_events: Array.isArray(data.webhook_events) ? data.webhook_events : [],
    };
  } catch {
    const seeded = emptyFile();
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function saveFile(data: JobsFile): Promise<void> {
  await writeJsonFile(jobsPath(), data);
}

export async function ensureSampleJob(): Promise<{
  job: DataJobRecord;
  schedule: DataJobScheduleRecord;
}> {
  const data = await loadFile();
  let job = data.jobs.find((j) => j.id === SAMPLE_GOLDEN_JOB.id);
  if (!job) {
    job = { ...SAMPLE_GOLDEN_JOB };
    data.jobs.push(job);
  }
  let schedule = data.schedules.find((s) => s.job_id === job!.id);
  if (!schedule) {
    schedule = {
      id: "sch_golden_path",
      job_id: job.id,
      cron: job.cron,
      enabled: true,
    };
    data.schedules.push(schedule);
  }
  await saveFile(data);
  return { job, schedule };
}

export async function listJobs(): Promise<DataJobRecord[]> {
  await ensureSampleJob();
  const data = await loadFile();
  return [...data.jobs].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listSchedules(): Promise<DataJobScheduleRecord[]> {
  await ensureSampleJob();
  const data = await loadFile();
  return [...data.schedules].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listRuns(opts?: {
  job_id?: string;
  limit?: number;
}): Promise<DataJobRunRecord[]> {
  await ensureSampleJob();
  const data = await loadFile();
  let rows = [...data.runs];
  if (opts?.job_id) rows = rows.filter((r) => r.job_id === opts.job_id);
  rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  return rows.slice(0, limit);
}

export async function listWebhookEvents(): Promise<WebhookEventRecord[]> {
  const data = await loadFile();
  return [...data.webhook_events];
}

function finishRun(
  partial: Omit<DataJobRunRecord, "finished_at" | "status" | "error"> & {
    force_fail?: boolean;
  },
): DataJobRunRecord {
  const now = new Date().toISOString();
  if (partial.force_fail) {
    return {
      ...partial,
      status: "failed",
      error: "simulated job failure",
      finished_at: now,
      snapshot_id: null,
      row_count: 0,
      written: 0,
    };
  }
  return {
    ...partial,
    status: "succeeded",
    error: null,
    finished_at: now,
    snapshot_id: partial.snapshot_id ?? `snap_${randomBytes(4).toString("hex")}`,
    row_count: partial.row_count || 2,
    written: partial.written || 2,
  };
}

async function appendRun(run: DataJobRunRecord, webhook?: WebhookEventRecord): Promise<DataJobRunRecord> {
  const data = await loadFile();
  data.runs.push(run);
  if (webhook) data.webhook_events.push(webhook);
  await saveFile(data);
  return run;
}

export async function tickJob(opts?: {
  job_id?: string;
  force_fail?: boolean;
  scheduled_for?: string;
}): Promise<DataJobRunRecord[]> {
  const { job, schedule } = await ensureSampleJob();
  const jobId = opts?.job_id?.trim() || job.id;
  if (jobId !== job.id) {
    throw new Error(`unknown job_id: ${jobId}`);
  }
  const started = new Date().toISOString();
  const base = {
    id: newId("run"),
    schedule_id: schedule.id,
    job_id: jobId,
    trigger: "schedule" as const,
    started_at: started,
    scheduled_for: opts?.scheduled_for ?? started,
    replay_of_snapshot_id: null,
    snapshot_id: null as string | null,
    row_count: 2,
    written: 2,
    force_fail: opts?.force_fail,
  };
  const run = finishRun(base);
  const webhook =
    run.status === "failed"
      ? {
          kind: FAIL_WEBHOOK_KIND,
          payload: {
            job_id: run.job_id,
            run_id: run.id,
            schedule_id: run.schedule_id,
            error: run.error,
            snapshot_id: run.snapshot_id,
            trigger: run.trigger,
          },
        }
      : undefined;
  await appendRun(run, webhook);
  return [run];
}

export async function rerunJob(job_id?: string): Promise<DataJobRunRecord> {
  const { job, schedule } = await ensureSampleJob();
  const id = job_id?.trim() || job.id;
  if (id !== job.id) throw new Error(`unknown job_id: ${id}`);
  const started = new Date().toISOString();
  const run = finishRun({
    id: newId("run"),
    schedule_id: schedule.id,
    job_id: id,
    trigger: "manual",
    started_at: started,
    scheduled_for: null,
    replay_of_snapshot_id: null,
    snapshot_id: null,
    row_count: 2,
    written: 2,
  });
  return appendRun(run);
}

export async function backfillJob(
  job_id: string | undefined,
  scheduled_for: string,
): Promise<DataJobRunRecord> {
  const { job, schedule } = await ensureSampleJob();
  const id = job_id?.trim() || job.id;
  if (id !== job.id) throw new Error(`unknown job_id: ${id}`);
  if (!scheduled_for?.trim()) throw new Error("scheduled_for required");
  const started = new Date().toISOString();
  const run = finishRun({
    id: newId("run"),
    schedule_id: schedule.id,
    job_id: id,
    trigger: "backfill",
    started_at: started,
    scheduled_for,
    replay_of_snapshot_id: null,
    snapshot_id: null,
    row_count: 2,
    written: 2,
  });
  return appendRun(run);
}

export async function replayJob(
  job_id: string | undefined,
  snapshot_id: string,
): Promise<DataJobRunRecord> {
  const { job, schedule } = await ensureSampleJob();
  const id = job_id?.trim() || job.id;
  if (id !== job.id) throw new Error(`unknown job_id: ${id}`);
  const snap = snapshot_id?.trim();
  if (!snap) throw new Error("snapshot_id required");
  const started = new Date().toISOString();
  const run = finishRun({
    id: newId("run"),
    schedule_id: schedule.id,
    job_id: id,
    trigger: "replay",
    started_at: started,
    scheduled_for: null,
    replay_of_snapshot_id: snap,
    snapshot_id: null,
    row_count: 2,
    written: 2,
  });
  return appendRun(run);
}

/** Test helper: wipe ops file under current store dir. */
export async function resetJobsStoreForTests(): Promise<void> {
  await writeJsonFile(jobsPath(), emptyFile());
}
