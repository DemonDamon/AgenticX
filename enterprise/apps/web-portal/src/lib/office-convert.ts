import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";

const execFile = promisify(execFileCb);

export type ConvertLegacyOfficeInput = {
  buffer: Buffer;
  fromExt: "doc" | "ppt";
  toExt: "docx" | "pptx";
};

export type OfficeConvertDeps = {
  resolveBin?: () => Promise<string | null>;
  execFile?: typeof execFile;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  rm?: typeof rm;
  access?: typeof access;
  tmpdir?: () => string;
};

const MISSING_LIBREOFFICE_MSG =
  "未检测到 LibreOffice，无法解析旧版 .doc/.ppt。macOS 可执行：brew install --cask libreoffice";

async function pathExists(path: string, accessFn: typeof access): Promise<boolean> {
  try {
    await accessFn(path, fsConstants.X_OK);
    return true;
  } catch {
    try {
      await accessFn(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/** Resolve LibreOffice CLI: LIBREOFFICE_BIN → soffice → libreoffice. */
export async function resolveLibreOfficeBin(
  deps: Pick<OfficeConvertDeps, "execFile" | "access"> = {},
): Promise<string | null> {
  const run = deps.execFile ?? execFile;
  const accessFn = deps.access ?? access;
  const envBin = process.env.LIBREOFFICE_BIN?.trim();
  if (envBin && (await pathExists(envBin, accessFn))) {
    return envBin;
  }

  for (const candidate of ["soffice", "libreoffice"]) {
    try {
      const { stdout } = await run(process.platform === "win32" ? "where" : "which", [candidate], {
        timeout: 5_000,
      });
      const first = stdout
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first) return first;
    } catch {
      // try next
    }
  }

  // macOS cask common path
  const macApp = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  if (await pathExists(macApp, accessFn)) return macApp;

  return null;
}

export async function convertLegacyOffice(
  input: ConvertLegacyOfficeInput,
  deps: OfficeConvertDeps = {},
): Promise<Buffer> {
  const resolveBin = deps.resolveBin ?? (() => resolveLibreOfficeBin(deps));
  const run = deps.execFile ?? execFile;
  const makeTemp = deps.mkdtemp ?? mkdtemp;
  const write = deps.writeFile ?? writeFile;
  const read = deps.readFile ?? readFile;
  const remove = deps.rm ?? rm;
  const baseTmp = deps.tmpdir ?? tmpdir;

  if (
    (input.fromExt === "doc" && input.toExt !== "docx") ||
    (input.fromExt === "ppt" && input.toExt !== "pptx")
  ) {
    throw new Error(`非法转换：.${input.fromExt} → .${input.toExt}`);
  }

  const bin = await resolveBin();
  if (!bin) {
    throw new Error(MISSING_LIBREOFFICE_MSG);
  }

  const dir = await makeTemp(join(baseTmp(), "agx-office-"));
  const id = ulid().toLowerCase();
  const inputPath = join(dir, `source-${id}.${input.fromExt}`);
  const expectedOut = join(dir, `source-${id}.${input.toExt}`);

  try {
    await write(inputPath, input.buffer);
    await run(
      bin,
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to",
        input.toExt,
        "--outdir",
        dir,
        inputPath,
      ],
      { timeout: 60_000 },
    );
    const converted = await read(expectedOut);
    if (!converted?.byteLength) {
      throw new Error(`LibreOffice 转换失败：未生成 .${input.toExt}`);
    }
    return Buffer.from(converted);
  } catch (error) {
    if (error instanceof Error && error.message.includes("LibreOffice")) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found|找不到/i.test(detail)) {
      throw new Error(MISSING_LIBREOFFICE_MSG);
    }
    throw new Error(`LibreOffice 转换失败：${detail}`);
  } finally {
    await remove(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const OFFICE_CONVERT_MISSING_MSG = MISSING_LIBREOFFICE_MSG;
