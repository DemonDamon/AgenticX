// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, useLayoutEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ImBubble } from "./ImBubble";

afterEach(() => {
  cleanup();
});

/** Parent layout updates forever. A closed menu must not be the setState that trips the depth limit. */
function LayoutLoopParent() {
  const [box, setBox] = useState({ w: 0 });
  useLayoutEffect(() => {
    setBox({ w: box.w + 1 });
  }, [box]);
  return (
    <ImBubble
      message={{
        id: "a1",
        role: "assistant",
        content: "[harness codebuddy turn error] 401 Unauthorized",
      }}
      onEditMessage={() => box.w}
      onQuoteToNewPane={() => box.w}
      onRetryMessage={() => box.w}
    />
  );
}

function LoginClickParent() {
  const [focus, setFocus] = useState<{ tabId: string } | null>(null);
  const [rev, setRev] = useState(0);
  useLayoutEffect(() => {
    if (!focus) return;
    setRev((n) => n + 1);
    setFocus(null);
  }, [focus]);
  return (
    <StrictMode>
      <button type="button" onClick={() => setFocus({ tabId: "term-1" })}>
        relogin
      </button>
      <span data-rev={rev} />
      <ImBubble
        message={{
          id: "a1",
          role: "assistant",
          content: "[harness codebuddy turn error] 401 Unauthorized",
        }}
        onEditMessage={() => rev}
        onQuoteToNewPane={() => rev}
        onRetryMessage={() => rev}
      />
    </StrictMode>
  );
}

describe("ImBubble closed menu layout", () => {
  it("does not trip max update depth from the closed menu when the parent re-renders", () => {
    let stack = "";
    try {
      render(<LayoutLoopParent />);
    } catch (err) {
      stack = err instanceof Error ? err.stack ?? err.message : String(err);
    }
    expect(stack).toMatch(/Maximum update depth/);
    expect(stack).not.toMatch(/ImBubble\.tsx/);
  });

  it("survives a login-style focus update with fresh callbacks", () => {
    const view = render(<LoginClickParent />);
    expect(() => fireEvent.click(view.getByRole("button", { name: "relogin" }))).not.toThrow();
    expect(view.getByRole("button", { name: "relogin" })).toBeTruthy();
  });
});
