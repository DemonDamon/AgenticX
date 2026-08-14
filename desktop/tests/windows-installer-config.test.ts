import fs from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type BuilderConfig = {
  win?: { target?: string[] };
  nsis?: {
    oneClick?: boolean;
    allowToChangeInstallationDirectory?: boolean;
  };
};

const CONFIG_FILES = ["electron-builder.yml", "electron-builder.signing.yml"];

describe("Windows installer configuration", () => {
  it.each(CONFIG_FILES)("offers an installation directory in %s", (fileName) => {
    const filePath = path.resolve(process.cwd(), fileName);
    const config = load(fs.readFileSync(filePath, "utf8")) as BuilderConfig;

    expect(config.win?.target).toContain("nsis");
    expect(config.nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
    });
  });
});
