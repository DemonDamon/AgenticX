import { describe, expect, it } from "vitest";
import { commentStyleFor, tokenizeCode } from "./codeTokenize";

const kinds = (code: string, lang?: string) =>
  tokenizeCode(code, lang ? commentStyleFor(lang) : undefined).map((t) => `${t.kind}:${t.text}`);

describe("commentStyleFor", () => {
  it("按语言分支注释语法，未知语言宽松双开", () => {
    expect(commentStyleFor("python")).toEqual({ hash: true, slash: false });
    expect(commentStyleFor("c")).toEqual({ hash: false, slash: true });
    expect(commentStyleFor("bash")).toEqual({ hash: true, slash: false });
    expect(commentStyleFor("")).toEqual({ hash: true, slash: true });
  });
});

describe("tokenizeCode", () => {
  it("Python：关键字/字符串/注释/函数名分色", () => {
    expect(kinds('n = count("hi")  # note\n', "python")).toEqual([
      "plain:n = ",
      "fn:count",
      "plain:(",
      'string:"hi"',
      "plain:)  ",
      "comment:# note",
      "plain:\n",
    ]);
  });

  it("C：#include 不算注释，// 生效", () => {
    expect(kinds('#include <stdio.h>\nint x; // c', "c")).toEqual([
      "plain:#",
      "keyword:include",
      "plain: <",
      "plain:stdio.",
      "plain:h>\n",
      "keyword:int",
      "plain: ",
      "plain:x; ",
      "comment:// c",
    ]);
  });

  it("f-string 前缀整体收进字符串", () => {
    expect(kinds('print(f"n={n}")', "python")).toEqual([
      "fn:print",
      "plain:(",
      'string:f"n={n}"',
      "plain:)",
    ]);
  });

  it("数字与标识符区分（变量名里的数字不着色）", () => {
    expect(kinds("x2 = 255")).toEqual(["plain:x2 = ", "number:255"]);
  });

  it("转义引号不终止字符串", () => {
    expect(kinds('s = "a\\"b"')).toEqual(["plain:s = ", 'string:"a\\"b"']);
  });

  it("关键字命中与函数名区分", () => {
    expect(kinds("def foo():")).toEqual(["keyword:def", "plain: ", "fn:foo", "plain:():"]);
  });
});
