/**
 * electron-builder afterSign: submit Near.app for Apple notarization when credentials exist.
 * Skips silently if APPLE_ID / APPLE_ID_PASSWORD / APPLE_TEAM_ID are unset.
 */

const { execFileSync } = require("node:child_process");
const { notarize } = require("@electron/notarize");

function assertDeveloperSigned(appPath) {
  let merged = "";
  try {
    merged = execFileSync("codesign", ["-dv", "--verbose=2", appPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    merged = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  if (/Signature=adhoc/.test(merged) || /flags=0x20002\(adhoc,linker-signed\)/.test(merged)) {
    throw new Error(
      `${appPath} is still adhoc/linker-signed. macOS code signing was skipped — ` +
        "ensure electron-builder.signing.yml does NOT set identity: null and CSC_LINK is valid.",
    );
  }
  if (!/TeamIdentifier=/.test(merged) || /TeamIdentifier=not set/.test(merged)) {
    throw new Error(
      `${appPath} has no TeamIdentifier in signature. Developer ID signing did not apply — ` +
        "check CSC_LINK / CSC_KEY_PASSWORD and re-run the workflow.",
    );
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
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("Skipping notarization: APPLE_ID / APPLE_ID_PASSWORD / APPLE_TEAM_ID not all set");
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
