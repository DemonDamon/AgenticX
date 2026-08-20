import { describe, expect, it } from "vitest";
import {
  addressForSession,
  ATTACHMENT_ROUTING_OFF,
  dismissRoutingNotice,
  modelPickerLock,
  routingNoticeDismissed,
  decideAttachmentRouting,
  hasRoutedDocument,
  readAttachmentRoutingPolicy,
  routingLockReason,
} from "./attachment-routing";

const QWEN = {
  id: "qwen_local/qwen3.8-27b",
  provider: "qwen_local",
  model: "qwen3.8-27b",
  label: "本地推理/Qwen3.8 27B",
};

const WIRE = {
  enabled: true,
  documentTarget: QWEN,
  documentExtensions: [".pdf", ".docx", ".pptx", ".xlsx"],
  imageStrategy: "vision-fallback",
  visionFallback: QWEN,
  maxRenderedPages: 20,
};

describe("readAttachmentRoutingPolicy", () => {
  it("reads a well-formed snapshot", () => {
    const policy = readAttachmentRoutingPolicy(WIRE);
    expect(policy.enabled).toBe(true);
    expect(policy.documentTarget).toEqual(QWEN);
    expect(policy.maxRenderedPages).toBe(20);
  });

  it("defaults to off for anything it does not recognise", () => {
    // 和 enterprise-capability-policy 的「默认全开」相反：那边配歪了最坏是少拦一道，
    // 这边配歪了会把会话锁死在一个取不到的模型上。
    for (const raw of [null, undefined, 42, "on", [], {}, { enabled: "yes" }]) {
      expect(readAttachmentRoutingPolicy(raw)).toEqual(ATTACHMENT_ROUTING_OFF);
    }
  });

  it("refuses to enable without a usable target", () => {
    expect(readAttachmentRoutingPolicy({ ...WIRE, documentTarget: null }).enabled).toBe(false);
    expect(
      readAttachmentRoutingPolicy({ ...WIRE, documentTarget: { provider: "", model: "m" } }).enabled,
    ).toBe(false);
  });

  it("refuses to enable with an empty or malformed extension list", () => {
    expect(readAttachmentRoutingPolicy({ ...WIRE, documentExtensions: [] }).enabled).toBe(false);
    expect(
      readAttachmentRoutingPolicy({ ...WIRE, documentExtensions: ["pdf", "", 7] }).enabled,
    ).toBe(false);
  });

  it("falls back to a sane page cap", () => {
    expect(readAttachmentRoutingPolicy({ ...WIRE, maxRenderedPages: 0 }).maxRenderedPages).toBe(20);
    expect(readAttachmentRoutingPolicy({ ...WIRE, maxRenderedPages: "x" }).maxRenderedPages).toBe(20);
    expect(readAttachmentRoutingPolicy({ ...WIRE, maxRenderedPages: 5 }).maxRenderedPages).toBe(5);
  });

  it("fills in label and id when the server omits them", () => {
    const policy = readAttachmentRoutingPolicy({
      ...WIRE,
      documentTarget: { provider: "p", model: "m" },
    });
    expect(policy.documentTarget?.label).toBe("p/m");
    // id 留空会让企业会话切到一个空模型名。
    expect(policy.documentTarget?.id).toBe("p/m");
  });
});

describe("hasRoutedDocument", () => {
  const policy = readAttachmentRoutingPolicy(WIRE);

  it("matches by extension, case-insensitively, across path separators", () => {
    expect(hasRoutedDocument(["年报.PDF"], policy)).toBe(true);
    expect(hasRoutedDocument(["C:\\Users\\a\\季报.DOCX"], policy)).toBe(true);
    expect(hasRoutedDocument(["/tmp/deck.pptx"], policy)).toBe(true);
  });

  it("does not fire on images — they go to the vision fallback instead", () => {
    expect(hasRoutedDocument(["shot.png", "photo.JPG", "a.webp"], policy)).toBe(false);
  });

  it("ignores names without a usable extension", () => {
    expect(hasRoutedDocument(["README", "", ".", "trailing."], policy)).toBe(false);
  });

  it("never fires while routing is off", () => {
    expect(hasRoutedDocument(["年报.pdf"], ATTACHMENT_ROUTING_OFF)).toBe(false);
  });
});

describe("decideAttachmentRouting", () => {
  const policy = readAttachmentRoutingPolicy(WIRE);

  it("does nothing without a document", () => {
    expect(
      decideAttachmentRouting({ policy, filenames: ["shot.png"], lockedTarget: null }),
    ).toEqual({ action: "none" });
  });

  it("locks and announces the first time a document appears", () => {
    expect(
      decideAttachmentRouting({ policy, filenames: ["年报.pdf"], lockedTarget: null }),
    ).toEqual({ action: "lock", target: QWEN, announce: true });
  });

  it("stays locked afterwards without announcing again", () => {
    // sticky：文档内容已经进了这段对话的上下文，换回纯文本模型要么看不见它、要么
    // 得抽成文本再发出去。所以后续每一轮都保持锁定。
    const decision = decideAttachmentRouting({
      policy,
      filenames: [],
      lockedTarget: QWEN,
    });
    expect(decision).toEqual({ action: "lock", target: QWEN, announce: false });
  });

  it("follows the currently delivered target after an admin swap", () => {
    const swapped = readAttachmentRoutingPolicy({
      ...WIRE,
      documentTarget: {
        id: "qwen_local/qwen4-32b",
        provider: "qwen_local",
        model: "qwen4-32b",
        label: "新模型",
      },
    });
    const decision = decideAttachmentRouting({
      policy: swapped,
      filenames: [],
      lockedTarget: QWEN,
    });
    // 老会话不该卡在一个已经下线的模型上。
    expect(decision).toEqual({
      action: "lock",
      target: {
        id: "qwen_local/qwen4-32b",
        provider: "qwen_local",
        model: "qwen4-32b",
        label: "新模型",
      },
      announce: false,
    });
  });

  it("does nothing at all while routing is off, even mid-session", () => {
    expect(
      decideAttachmentRouting({
        policy: ATTACHMENT_ROUTING_OFF,
        filenames: ["年报.pdf"],
        lockedTarget: QWEN,
      }),
    ).toEqual({ action: "none" });
  });
});

describe("routingLockReason", () => {
  it("names the model and says where the data stays", () => {
    const reason = routingLockReason(QWEN);
    expect(reason).toContain(QWEN.label);
    expect(reason).toContain("私有部署");
  });
});


describe("addressForSession", () => {
  it("uses the full id for enterprise-managed sessions", () => {
    // 企业登录后所有模型挂在单一 enterprise provider 下，模型名就是全 id。
    expect(addressForSession({ provider: "enterprise" }, QWEN)).toEqual({
      provider: "enterprise",
      model: "qwen_local/qwen3.8-27b",
    });
  });

  it("uses provider + model for directly configured sessions", () => {
    expect(addressForSession({ provider: "zhipu" }, QWEN)).toEqual({
      provider: "qwen_local",
      model: "qwen3.8-27b",
    });
    expect(addressForSession(null, QWEN).provider).toBe("qwen_local");
  });
});

describe("notice dismissal", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    };
  }

  it("round-trips the dismissal flag", () => {
    const store = fakeStorage();
    expect(routingNoticeDismissed(store)).toBe(false);
    dismissRoutingNotice(store);
    expect(routingNoticeDismissed(store)).toBe(true);
  });

  it("treats a throwing storage as not dismissed", () => {
    const boom = {
      getItem() {
        throw new Error("private mode");
      },
      setItem() {
        throw new Error("private mode");
      },
    };
    expect(routingNoticeDismissed(boom)).toBe(false);
    expect(() => dismissRoutingNotice(boom)).not.toThrow();
  });
});

describe("modelPickerLock", () => {
  it("is open when nothing is locked", () => {
    expect(modelPickerLock(null)).toEqual({ disabled: false, reason: "" });
  });

  it("disables with a reason once locked — the state stays visible even if the dialog is muted", () => {
    const lock = modelPickerLock(QWEN);
    expect(lock.disabled).toBe(true);
    expect(lock.reason).toContain(QWEN.label);
    expect(lock.reason).toContain("私有部署");
  });
});
