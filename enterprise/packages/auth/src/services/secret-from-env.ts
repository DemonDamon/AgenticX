import { readFileSync } from "node:fs";

/**
 * 读一个密钥类环境变量，裸变量优先，其次 `<NAME>_FILE` 指向的文件。
 *
 * `.env.local.example` 只教了 `*_FILE` 那一种写法（PEM 是多行，塞不进 .env），
 * 但过去只有 start-dev.sh 会把它展开成裸变量。于是照模板配好之后 `pnpm dev`
 * 直起就报「AUTH_JWT_PRIVATE_KEY is required」——变量明明配了，报错却说没配。
 *
 * 放在代码里还顺手接上了 Docker/K8s 的 secret 文件挂载：`_FILE` 后缀本来就是
 * 那边的通用约定，密钥可以只以文件形式存在，不必进环境变量。
 */
export function readSecretFromEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const direct = env[name];
  if (direct && direct.trim()) return direct;

  const path = env[`${name}_FILE`];
  if (!path || !path.trim()) return undefined;

  try {
    const content = readFileSync(path.trim(), "utf8");
    // PEM / token 文件末尾几乎必有换行，原样带上会让下游比较和解析都出错。
    return content.trim() ? content.replace(/\r?\n$/, "") : undefined;
  } catch (error) {
    // 明确指出是哪个变量指到了读不了的路径，否则错误会退化成「密钥未配置」。
    throw new Error(
      `${name}_FILE points at an unreadable path (${path.trim()}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
