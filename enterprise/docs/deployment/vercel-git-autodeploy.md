# Vercel Git 自动部署与 Ignored Build Step

> 适用：`agxbuilder-admin-console`、`agxbuilder-web-portal` 两个独立 Project，仓库根为 `DemonDamon/AgenticX`。

## 1. 连接 Git（必做）

在 Vercel 每个 Project → **Settings → Git**：

1. **Connect Git Repository** → 选 `DemonDamon/AgenticX`
2. **Production Branch** = `main`
3. 确认未开启 **Pause Deployments**

连接成功后，对 `main` 的 push 应在 GitHub commit 上出现 **Vercel** 的 check/deployment（此前缺失即表示未接通）。

## 2. Root Directory / Build（与 checklist 一致）

| Project | Root Directory | Build Command |
| --- | --- | --- |
| admin-console | `enterprise/apps/admin-console` | `cd ../.. && pnpm exec turbo run build --filter=@agenticx/app-admin-console` |
| web-portal | `enterprise/apps/web-portal` | `cd ../.. && pnpm exec turbo run build --filter=@agenticx/app-web-portal` |

Install / Build（两端，**必须**用 `npx pnpm@9.12.0`，Vercel 默认 `pnpm` 为 6.x 且会盖过 `npm i -g`）：

```bash
# install
cd ../.. && npx --yes pnpm@9.12.0 install --no-frozen-lockfile

# build
cd ../.. && npx --yes pnpm@9.12.0 exec turbo run build --filter=@agenticx/app-admin-console
```

`--no-frozen-lockfile` 原因：`enterprise/pnpm-lock.yaml` 在 `enterprise/.gitignore` 中，Git 克隆后无 lockfile。

各 App 目录下 `vercel.json` 已固化上述命令；请提交并 push，避免 Dashboard 仍显示旧的 `cd ../.. && pnpm install` 触发 pnpm 6 报错。

## 3. Ignored Build Step（monorepo 推荐）

在 **Settings → Git → Ignored Build Step** 填入下面脚本。  
**admin-console** 与 **web-portal** 各用对应那一行（把 `APP_ROOT` 换成自己的根目录）。

```bash
# 仅当本次提交影响到本 App 或共享包时才构建；其它目录（如 desktop/）的 push 跳过本 Project。
APP_ROOT="enterprise/apps/admin-console"   # web-portal 改为 enterprise/apps/web-portal

if [ "$VERCEL_GIT_COMMIT_REF" != "main" ] && [ "$VERCEL_ENV" = "production" ]; then
  # Preview：仍构建（可按需改为 exit 0 跳过非 main 的 preview）
  :
fi

git diff --name-only "${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}" "$VERCEL_GIT_COMMIT_SHA" 2>/dev/null | while read -r f; do
  case "$f" in
    ${APP_ROOT}/*|enterprise/packages/*|enterprise/features/*|enterprise/pnpm-lock.yaml|enterprise/package.json|enterprise/turbo.json)
      exit 1
      ;;
  esac
done
exit 0
```

说明：

- 脚本 **exit 1** = 需要构建，**exit 0** = 跳过。
- `enterprise/packages/*`、`enterprise/features/*` 变更会同时触发两个 App（符合 workspace 依赖）。
- Channel 等改动在 `enterprise/apps/admin-console/` 下，**必须**触发 admin-console 构建。

## 4. 手动发布最新 main（Git 未接通时的应急）

**Deployments → Create Deployment** → Branch `main` → 选最新 commit（如 `e652e91`）。

勿对旧 deployment 点 **Redeploy**（会继续保持 `95e2add` 等旧 SHA）。

## 5. 验收

| 检查项 | 期望 |
| --- | --- |
| Production `gitCommitSha` | ≥ `27166b0`（含 Channel） |
| 触发来源 | Git push，而非仅 `cursor-cli` redeploy |
| admin 侧栏 | 「Channel 管理」可见 |
| URL | `/admin/channels` 非 404 |
