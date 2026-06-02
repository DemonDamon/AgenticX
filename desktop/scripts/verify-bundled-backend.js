// afterPack hook: fail the build if the embedded agx-server backend is missing
// from the packaged app. Mirrors the CI "Verify bundled backend" guard so that
// LOCAL electron-builder runs (which skip the workflow's verify steps) cannot
// silently ship a backend-less DMG/exe that would fall back to a PATH `agx`
// (possibly a stale pip install) at runtime.
const fs = require("fs");
const path = require("path");

exports.default = async function verifyBundledBackend(context) {
  const platform = context.electronPlatformName; // 'darwin' | 'win32' | 'linux'

  // Linux AppImage target does not bundle the backend (no extraResources/backend);
  // nothing to verify there.
  if (platform === "linux") return;

  const productFilename = context.packager.appInfo.productFilename; // e.g. "Near"
  const exe = platform === "win32" ? "agx-server.exe" : "agx-server";
  const backendDir =
    platform === "darwin"
      ? path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Resources", "backend")
      : path.join(context.appOutDir, "resources", "backend");

  const binary = path.join(backendDir, exe);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `[afterPack] Bundled backend missing: ${binary}\n` +
        `Without it the packaged app falls back to a PATH 'agx' (possibly a stale pip install).\n` +
        `Run packaging/build_backend.sh and stage desktop/bundled-backend/<arch>/ before packaging.`,
    );
  }
  console.log(`[afterPack] Verified bundled backend: ${binary}`);
};
