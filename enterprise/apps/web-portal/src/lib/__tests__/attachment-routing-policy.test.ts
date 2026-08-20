import { describe, expect, it } from "vitest";
import {
  DISABLED_ATTACHMENT_ROUTING,
  hasRoutedDocument,
  isLockedToRoutingTarget,
} from "@agenticx/config";

import type { PortalModelOption } from "../admin-providers-reader";
import { buildAttachmentRoutingPolicy } from "../attachment-routing-policy";

function model(
  id: string,
  capabilities: string[],
  provider = id.split("/")[0]!,
): PortalModelOption {
  return {
    id,
    provider,
    providerLabel: provider,
    model: id.split("/")[1] ?? id,
    label: id,
    route: "direct" as PortalModelOption["route"],
    isDefault: false,
    capabilities,
  };
}

const QWEN = model("qwen_local/qwen3.8-27b", ["text", "vision", "private-deployment"]);
const GLM = model("zhipu/glm-5.2", ["text"]);
const CLOUD_VISION = model("aliyun/qwen-vl-max", ["text", "vision"]);

describe("buildAttachmentRoutingPolicy", () => {
  it("is disabled when the user is not authorized", () => {
    expect(buildAttachmentRoutingPolicy([QWEN, GLM], { enabled: false })).toEqual(
      DISABLED_ATTACHMENT_ROUTING,
    );
  });

  it("picks the private multimodal model as the document target", () => {
    const policy = buildAttachmentRoutingPolicy([GLM, QWEN, CLOUD_VISION], { enabled: true });
    expect(policy.enabled).toBe(true);
    expect(policy.documentTarget).toEqual({
      // id 也要带：Desktop 把企业模型全挂在单一 enterprise provider 下、拿这个 id
      // 当 model 名，只给 provider/model 它就得自己拼，拼错就切到不存在的模型。
      id: "qwen_local/qwen3.8-27b",
      provider: "qwen_local",
      model: "qwen3.8-27b",
      label: "qwen_local/qwen3.8-27b",
    });
    // 图片不锁会话模型。
    expect(policy.imageStrategy).toBe("vision-fallback");
  });

  it("keeps images inside the private deployment when it can", () => {
    const policy = buildAttachmentRoutingPolicy([CLOUD_VISION, QWEN], { enabled: true });
    expect(policy.visionFallback?.provider).toBe("qwen_local");
  });

  it("turns everything off when no private multimodal model is visible", () => {
    // 授权开着但私有模型还没上线：宁可整条不生效，也不能"检测到文档但无处可切"，
    // 那会把附件落回公网模型，而用户已经被告知它会留在私有部署里。
    const policy = buildAttachmentRoutingPolicy([GLM, CLOUD_VISION], { enabled: true });
    expect(policy).toEqual(DISABLED_ATTACHMENT_ROUTING);
  });

  it("is stable across calls when several models qualify", () => {
    const other = model("aaa_local/vl-7b", ["vision", "private-deployment"]);
    const a = buildAttachmentRoutingPolicy([QWEN, other], { enabled: true });
    const b = buildAttachmentRoutingPolicy([other, QWEN], { enabled: true });
    expect(a.documentTarget).toEqual(b.documentTarget);
  });
});

describe("hasRoutedDocument", () => {
  const policy = buildAttachmentRoutingPolicy([QWEN], { enabled: true });

  it("matches documents by extension, case-insensitively", () => {
    expect(hasRoutedDocument(["年报.PDF"], policy)).toBe(true);
    expect(hasRoutedDocument(["a.docx", "b.png"], policy)).toBe(true);
  });

  it("does not fire on images — they go to the vision fallback instead", () => {
    expect(hasRoutedDocument(["screenshot.png", "photo.jpg"], policy)).toBe(false);
  });

  it("never fires while the policy is off", () => {
    expect(hasRoutedDocument(["年报.pdf"], DISABLED_ATTACHMENT_ROUTING)).toBe(false);
  });

  it("ignores names with no extension", () => {
    expect(hasRoutedDocument(["README", "", "."], policy)).toBe(false);
  });
});

describe("isLockedToRoutingTarget", () => {
  const policy = buildAttachmentRoutingPolicy([QWEN], { enabled: true });

  it("recognises a session already pinned to the target", () => {
    expect(
      isLockedToRoutingTarget({ provider: "qwen_local", model: "qwen3.8-27b" }, policy),
    ).toBe(true);
    expect(isLockedToRoutingTarget({ provider: "zhipu", model: "glm-5.2" }, policy)).toBe(false);
    expect(isLockedToRoutingTarget(null, policy)).toBe(false);
  });
});
