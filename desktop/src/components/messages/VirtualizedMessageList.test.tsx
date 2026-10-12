/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { VirtualizedMessageList } from "./VirtualizedMessageList";

function Harness({ count }: { count: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} style={{ height: 400, overflow: "auto" }} data-testid="scroll">
      <VirtualizedMessageList
        scrollRef={scrollRef}
        count={count}
        estimateSize={80}
        overscan={2}
        renderItem={(index) => (
          <div data-testid={`row-${index}`} style={{ height: 80 }}>
            row {index}
          </div>
        )}
        getItemKey={(index) => `k-${index}`}
      />
    </div>
  );
}

describe("VirtualizedMessageList", () => {
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight"
  );

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 400;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 400;
      },
    });
  });

  afterEach(() => {
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("mounts far fewer DOM rows than the full count", async () => {
    const { container } = render(<Harness count={160} />);
    await waitFor(() => {
      const mounted = container.querySelectorAll("[data-virtual-message-row='1']");
      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThan(40);
    });
  });
});
