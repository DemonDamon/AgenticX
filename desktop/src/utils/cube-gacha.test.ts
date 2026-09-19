import { describe, expect, it } from "vitest";
import { parseGachaCubeColorway } from "./cube-gacha";

describe("parseGachaCubeColorway", () => {
  it("accepts a clean dual skin", () => {
    const way = parseGachaCubeColorway(
      '{"kind":"dual","lid":"#0F172A","body":"#FB7185","eye":"#FFFFFF"}',
      "gacha-test",
    );
    expect(way).toEqual({
      id: "gacha-test",
      kind: "dual",
      lid: "#0F172A",
      body: "#FB7185",
      eye: "#FFFFFF",
    });
  });

  it("rejects marble and speckle payloads", () => {
    expect(
      parseGachaCubeColorway('{"kind":"marble","body":"#FFF7ED","blob":"#111111","blob2":"#F97316"}'),
    ).toBeNull();
  });

  it("reads JSON from a fenced model reply", () => {
    const way = parseGachaCubeColorway(
      '好的\n```json\n{"kind":"dream","stops":["#A78BFA","#6EE7B7","#FDBA74"],"angle":40,"eye":"#fff7ed"}\n```',
      "gacha-dream",
    );
    expect(way?.kind).toBe("dream");
    expect(way?.stops).toEqual(["#A78BFA", "#6EE7B7", "#FDBA74"]);
    expect(way?.eye).toBe("#1C1917");
  });

  it("forces dark eyes and a readable body when the model returns white-on-white", () => {
    const way = parseGachaCubeColorway(
      '{"kind":"dual","lid":"#111111","body":"#FFFFFF","eye":"#FFFFFF"}',
      "gacha-dalmatian",
    );
    expect(way?.body).not.toBe("#FFFFFF");
    expect(way?.eye).toBe("#1C1917");
  });
});
