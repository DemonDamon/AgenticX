import { describe, expect, it } from "vitest";
import { detectFoldRanges, guideCoversLine, hiddenLinesForFolds } from "./code-source-fold";

const GO = `package main

import (
    "fmt"
    "os"
)

func main() {
    content := "Hello World"
    if err := os.WriteFile("hello.txt", []byte(content), 0644); err != nil {
        fmt.Println("写入失败:", err)
        os.Exit(1)
    }
    fmt.Println("已保存")
}
`;

const PY = `def main():
    print("Hello World")
    if True:
        print("ok")
`;

describe("detectFoldRanges", () => {
  it("folds Go import / func / if blocks", () => {
    const ranges = detectFoldRanges(GO, "go");
    expect(ranges).toEqual(
      expect.arrayContaining([
        { start: 3, end: 6 },
        { start: 8, end: 15 },
        { start: 10, end: 13 },
      ]),
    );
  });

  it("folds Python def / if by indent", () => {
    const ranges = detectFoldRanges(PY, "python");
    expect(ranges).toEqual(
      expect.arrayContaining([
        { start: 1, end: 4 },
        { start: 3, end: 4 },
      ]),
    );
  });

  it("hides the interior of a folded range", () => {
    const hidden = hiddenLinesForFolds([{ start: 8, end: 16 }], new Set([8]));
    expect(hidden.has(8)).toBe(false);
    expect(hidden.has(9)).toBe(true);
    expect(hidden.has(16)).toBe(true);
    expect(hidden.has(17)).toBe(false);
  });
});

describe("guideCoversLine", () => {
  const main = { start: 8, end: 15 };
  const innerIf = { start: 10, end: 13 };

  it("paints interior lines but not the opening line", () => {
    expect(guideCoversLine(main, 8, "func main() {")).toBe(false);
    expect(guideCoversLine(main, 14, '    fmt.Println("已保存")')).toBe(true);
  });

  it("stops before a closing brace or paren so the guide does not run under }", () => {
    expect(guideCoversLine(main, 15, "}")).toBe(false);
    expect(guideCoversLine(innerIf, 13, "    }")).toBe(false);
    expect(guideCoversLine({ start: 3, end: 6 }, 6, ")")).toBe(false);
  });

  it("still covers the last indented line of a Python block", () => {
    expect(guideCoversLine({ start: 1, end: 4 }, 4, '        print("ok")')).toBe(true);
    expect(guideCoversLine({ start: 3, end: 4 }, 4, '        print("ok")')).toBe(true);
  });
});
