/**
 * electron-builder afterSign: submit Machi.app for Apple notarization when credentials exist.
 * Skips silently if APPLE_ID / APPLE_ID_PASSWORD / APPLE_TEAM_ID are unset.
 */

const { notarize } = require("@electron/notarize");

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
