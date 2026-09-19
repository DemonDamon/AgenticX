import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NearLineArtMark } from "./NearLineArtMark";

describe("NearLineArtMark", () => {
  it("renders the official cube shell as currentColor line art", () => {
    const html = renderToStaticMarkup(<NearLineArtMark label="Near" className="h-7 w-7" />);
    expect(html).toContain('data-avatar-fit="line-art"');
    expect(html).toContain("currentColor");
    expect(html).toContain("M64.1 17.1");
    expect(html).toContain("Near");
  });
});
