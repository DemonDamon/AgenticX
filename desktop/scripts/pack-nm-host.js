// afterPack hook (SP6): bundle the NM bridge shim into the packaged app so
// the "installed" mode of desktop/electron/native-messaging-host.ts can run
// it with ELECTRON_RUN_AS_NODE=1 — no system node dependency on end-user
// machines. Follows the layout convention of verify-bundled-backend.js.
const fs = require("fs");
const path = require("path");
const repoRoot = path.resolve(__dirname, "..", "..");

exports.default = async function packNmHost(context) {
  const platform = context.electronPlatformName; // 'darwin' | 'win32' | 'linux'
  const productFilename = context.packager.appInfo.productFilename; // e.g. "Near"
  const resourcesDir =
    platform === "darwin"
      ? path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");

  const targetDir = path.join(resourcesDir, "extension-host");
  const src = path.join(repoRoot, "scripts", "nm-bridge-shim.mjs");
  const dest = path.join(targetDir, "nm-bridge-shim.mjs");
  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] NM bridge shim missing from repo: ${src}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[afterPack] Bundled NM host shim: ${dest}`);
};
