/**
 * electron-builder afterSign: submit Near.app for Apple notarization when credentials exist.
 * Skips silently if APPLE_ID / password / APPLE_TEAM_ID are unset.
 * Password: APPLE_APP_SPECIFIC_PASSWORD（electron-builder 约定）或 APPLE_ID_PASSWORD（GitHub Secret 名）。
 */

const { spawnSync } = require("node:child_process");
const { notarize } = require("@electron/notarize");

function codesignOutput(appPath, args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    text: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function assertDeveloperSigned(appPath) {
  // codesign -dv 成功时信息在 stderr；execFileSync 只读 stdout 会误判为未签名
  const detail = codesignOutput(appPath, ["-dv", "--verbose=2", appPath]);
  const merged = detail.text;
  if (/Signature=adhoc/.test(merged) || /flags=0x20002\(adhoc,linker-signed\)/.test(merged)) {
    throw new Error(
      `${appPath} is still adhoc/linker-signed. macOS code signing was skipped — ` +
        "ensure electron-builder.signing.yml does NOT set identity: null and CSC_LINK is valid.",
    );
  }
  if (/TeamIdentifier=not set/.test(merged)) {
    throw new Error(
      `${appPath} has no TeamIdentifier in signature. Developer ID signing did not apply — ` +
        "check CSC_LINK / CSC_KEY_PASSWORD and re-run the workflow.",
    );
  }
  const verify = codesignOutput(appPath, ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  if (verify.status !== 0) {
    throw new Error(`${appPath} failed codesign verify:\n${verify.text}`);
  }
}

/**
 * @param {import("electron-builder").AfterSignContext} context
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword =
    process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD (or APPLE_ID_PASSWORD) / APPLE_TEAM_ID not all set",
    );
    return;
  }

  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`Verifying Developer ID signature on ${appPath}...`);
  assertDeveloperSigned(appPath);
  console.log(`Notarizing ${appPath}...`);
  await notarize({
    appBundleId: "com.agenticx.desktop",
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log("Notarization complete");
};
