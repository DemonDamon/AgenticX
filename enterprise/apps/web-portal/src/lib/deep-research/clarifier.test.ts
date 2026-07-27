import { describe, expect, it } from "vitest";
import { parseClarifierJson } from "./clarifier";

describe("parseClarifierJson", () => {
  it("returns needed false for invalid JSON", () => {
    expect(parseClarifierJson("not-json")).toEqual({ needed: false });
    expect(parseClarifierJson("")).toEqual({ needed: false });
  });

  it("parses standard JSON and clamps to 2 questions", () => {
    const payload = {
      needed: true,
      questions: [
        {
          id: "q1",
          question: "场景？",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        {
          id: "q2",
          question: "渠道？",
          options: [
            { id: "c", label: "C" },
            { id: "d", label: "D" },
          ],
        },
        {
          id: "q3",
          question: "多余？",
          options: [
            { id: "e", label: "E" },
            { id: "f", label: "F" },
          ],
        },
      ],
    };
    const result = parseClarifierJson(JSON.stringify(payload));
    expect(result.needed).toBe(true);
    if (result.needed) {
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]?.id).toBe("q1");
    }
  });

  it("accepts fenced JSON", () => {
    const result = parseClarifierJson('```json\n{"needed":false}\n```');
    expect(result).toEqual({ needed: false });
  });
});
