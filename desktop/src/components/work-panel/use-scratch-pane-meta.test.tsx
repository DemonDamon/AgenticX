// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store";
import { useScratchPaneMeta } from "./use-scratch-pane-meta";

afterEach(() => {
  cleanup();
});

function Probe({ paneId }: { paneId: string }) {
  const meta = useScratchPaneMeta(paneId);
  return <div data-testid="meta">{`${meta.avatarId ?? ""}:${meta.modelProvider}:${meta.modelName}`}</div>;
}

describe("useScratchPaneMeta", () => {
  it("can mount without a store-subscription update loop", async () => {
    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    expect(paneId).toBeTruthy();
    expect(() => {
      render(<Probe paneId={paneId} />);
    }).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector("[data-testid=meta]")).toBeTruthy();
  });
});
