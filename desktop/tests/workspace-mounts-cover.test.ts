import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findCoveringNonLinkMount,
  writeMounts,
  type MountRecord,
} from "../electron/workspace-mounts";

describe("findCoveringNonLinkMount", () => {
  it("returns reference mount covering a nested file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-mount-cover-"));
    try {
      const defaultDir = path.join(tmp, "default");
      const research = path.join(tmp, "research-agent");
      fs.mkdirSync(defaultDir, { recursive: true });
      fs.mkdirSync(research, { recursive: true });
      const nested = path.join(research, "requirements.txt");
      fs.writeFileSync(nested, "x\n", "utf8");

      const record: MountRecord = {
        name: "research-agent",
        mode: "reference",
        source_path: research,
        linked_at: Date.now() / 1000,
      };
      await writeMounts(defaultDir, [record]);

      const hit = await findCoveringNonLinkMount(defaultDir, nested);
      expect(hit?.name).toBe("research-agent");
      expect(hit?.mode).toBe("reference");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null for a similar prefix that is not a child path", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-mount-cover-"));
    try {
      const defaultDir = path.join(tmp, "default");
      const research = path.join(tmp, "research-agent");
      const other = path.join(tmp, "research-agent-other");
      fs.mkdirSync(defaultDir, { recursive: true });
      fs.mkdirSync(research, { recursive: true });
      fs.mkdirSync(other, { recursive: true });
      const otherFile = path.join(other, "x.txt");
      fs.writeFileSync(otherFile, "x\n", "utf8");

      await writeMounts(defaultDir, [
        {
          name: "research-agent",
          mode: "reference",
          source_path: research,
          linked_at: Date.now() / 1000,
        },
      ]);

      const hit = await findCoveringNonLinkMount(defaultDir, otherFile);
      expect(hit).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores link-mode ancestor mounts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-mount-cover-"));
    try {
      const defaultDir = path.join(tmp, "default");
      const research = path.join(tmp, "research-agent");
      fs.mkdirSync(defaultDir, { recursive: true });
      fs.mkdirSync(research, { recursive: true });
      const nested = path.join(research, "requirements.txt");
      fs.writeFileSync(nested, "x\n", "utf8");

      await writeMounts(defaultDir, [
        {
          name: "research-agent",
          mode: "link",
          source_path: research,
          linked_at: Date.now() / 1000,
        },
      ]);

      const hit = await findCoveringNonLinkMount(defaultDir, nested);
      expect(hit).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
