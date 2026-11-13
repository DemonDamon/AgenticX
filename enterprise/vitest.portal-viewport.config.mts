import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const config = JSON.parse(readFileSync(new URL("./tsconfig.base.json", import.meta.url), "utf8"));
const alias = Object.fromEntries(Object.entries(config.compilerOptions.paths as Record<string, string[]>)
  .filter(([key]) => !key.includes("*"))
  .map(([key, paths]) => [key, fileURLToPath(new URL(paths[0]!, import.meta.url))]));

export default defineConfig({
  resolve: { alias },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { pretendToBeVisual: true } },
    include: [
      "features/chat/src/utils/fold-segment-layout.test.ts",
      "features/chat/src/hooks/useUsableViewport.test.ts",
      "features/chat/src/components/molecules/AttachmentContentPanel.mobile.test.tsx",
      "features/chat/src/components/molecules/DeepResearchFilesPanel.layout.test.tsx",
      "features/chat/src/components/molecules/deep-research-files-panel-resize.test.ts",
      "apps/web-portal/src/components/WorkspaceShell.modes.test.tsx",
      "features/chat/src/utils/scroll-near-bottom.test.ts",
    ],
  },
});
