import { DOMParser } from "@xmldom/xmldom";
import type JSZip from "jszip";
import { posix } from "node:path";

type XmlElement = Element;
type Matrix = [number, number, number, number, number, number];
type TextBlock = { text: string; x?: number; y?: number; height?: number };
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function parseXml(xml: string) {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("PPTX XML must not contain a DOCTYPE");
  const fail = () => { throw new Error("Invalid PPTX XML"); };
  return new DOMParser({ errorHandler: { warning: () => {}, error: fail, fatalError: fail } })
    .parseFromString(xml, "application/xml");
}

function children(node: XmlElement): XmlElement[] {
  return Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1);
}

function child(node: XmlElement, name: string) {
  return children(node).find((element) => element.localName === name);
}

function numberAttr(node: XmlElement | undefined, name: string): number | undefined {
  const value = node?.getAttribute(name);
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function point(matrix: Matrix, x: number, y: number) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function transform(xfrm: XmlElement, group = false): Matrix | undefined {
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  const x = numberAttr(off, "x"), y = numberAttr(off, "y");
  const width = numberAttr(ext, "cx"), height = numberAttr(ext, "cy");
  if (x === undefined || y === undefined || width === undefined || height === undefined) return;
  const angle = (numberAttr(xfrm, "rot") ?? 0) / 60000 * Math.PI / 180;
  const flipX = ["1", "true"].includes(xfrm.getAttribute("flipH") ?? "") ? -1 : 1;
  const flipY = ["1", "true"].includes(xfrm.getAttribute("flipV") ?? "") ? -1 : 1;
  const rotation: Matrix = [Math.cos(angle) * flipX, Math.sin(angle) * flipX,
    -Math.sin(angle) * flipY, Math.cos(angle) * flipY, 0, 0];
  const chOff = child(xfrm, "chOff"), chExt = child(xfrm, "chExt");
  const sx = group ? width / (numberAttr(chExt, "cx") || width || 1) : 1;
  const sy = group ? height / (numberAttr(chExt, "cy") || height || 1) : 1;
  return multiply(multiply([1, 0, 0, 1, x + width / 2, y + height / 2], rotation),
    [sx, 0, 0, sy, -width / 2 - (group ? numberAttr(chOff, "x") ?? 0 : 0) * sx,
      -height / 2 - (group ? numberAttr(chOff, "y") ?? 0 : 0) * sy]);
}

function paragraphText(node: XmlElement): string {
  if (node.localName === "t") return node.textContent ?? "";
  if (node.localName === "br") return "\n";
  if (node.localName === "tab") return "\t";
  return children(node).map(paragraphText).join("");
}

function bodyText(node: XmlElement): string {
  return Array.from(node.getElementsByTagNameNS("*", "p"))
    .map(paragraphText).filter((text) => text.trim()).join("\n");
}

function shapeText(node: XmlElement): string {
  const table = node.getElementsByTagNameNS("*", "tbl")[0];
  if (table) {
    return children(table).filter((row) => row.localName === "tr")
      .map((row) => children(row).filter((cell) => cell.localName === "tc").map(bodyText).join("\t"))
      .join("\n").trim();
  }
  return bodyText(node).trim();
}

function collectBlocks(tree: XmlElement, parent: Matrix, blocks: TextBlock[]) {
  for (const shape of children(tree)) {
    if (shape.localName === "grpSp") {
      const props = child(shape, "grpSpPr");
      const xfrm = props && child(props, "xfrm");
      collectBlocks(shape, multiply(parent, (xfrm && transform(xfrm, true)) || IDENTITY), blocks);
      continue;
    }
    const text = shapeText(shape);
    if (!text) continue;
    const props = child(shape, "spPr");
    const xfrm = child(shape, "xfrm") ?? (props && child(props, "xfrm"));
    const local = xfrm && transform(xfrm);
    if (!local || !xfrm) {
      blocks.push({ text });
      continue;
    }
    const matrix = multiply(parent, local);
    const ext = child(xfrm, "ext");
    const width = numberAttr(ext, "cx") ?? 0, height = numberAttr(ext, "cy") ?? 0;
    const corners = [point(matrix, 0, 0), point(matrix, width, 0), point(matrix, 0, height), point(matrix, width, height)];
    const top = Math.min(...corners.map((p) => p.y));
    blocks.push({ text, x: Math.min(...corners.map((p) => p.x)), y: top,
      height: Math.max(...corners.map((p) => p.y)) - top });
  }
}

function slideText(xml: string): string {
  const doc = parseXml(xml);
  const tree = doc.getElementsByTagNameNS("*", "spTree")[0];
  if (!tree) return Array.from(doc.getElementsByTagNameNS("*", "t")).map((t) => t.textContent).join(" ").trim();
  const blocks: TextBlock[] = [];
  collectBlocks(tree, IDENTITY, blocks);
  const positioned = blocks.filter((block) => block.y !== undefined).sort((a, b) => a.y! - b.y!);
  const rows: TextBlock[][] = [];
  for (const block of positioned) {
    const row = rows.at(-1);
    const anchor = row?.[0];
    const tolerance = Math.min(anchor?.height ?? 0, block.height ?? 0) / 4;
    if (anchor && Math.abs(block.y! - anchor.y!) <= tolerance) row!.push(block);
    else rows.push([block]);
  }
  const ordered = rows.flatMap((row) => row.sort((a, b) => a.x! - b.x!));
  let next = 0;
  return blocks.map((block) => block.y === undefined ? block.text : ordered[next++]!.text).join("\n");
}

async function slidePaths(zip: JSZip): Promise<string[]> {
  const presentation = zip.file("ppt/presentation.xml"), rels = zip.file("ppt/_rels/presentation.xml.rels");
  if (!presentation || !rels) {
    return Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const doc = parseXml(await presentation.async("string"));
  const relationships = parseXml(await rels.async("string"));
  const targets = new Map(Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))
    .filter((rel) => rel.getAttribute("Type")?.endsWith("/slide") && rel.getAttribute("TargetMode") !== "External")
    .map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")]));
  const list = doc.getElementsByTagNameNS("*", "sldIdLst")[0];
  return (list ? children(list) : []).filter((element) => element.localName === "sldId").map((element) => {
    const id = Array.from(element.attributes).find((attr) => attr.localName === "id" && !!attr.namespaceURI)?.value;
    const target = id && targets.get(id);
    const path = target && posix.normalize(target.startsWith("/") ? target.slice(1) : `ppt/${target}`);
    if (!path || !/^ppt\/slides\/[^/]+\.xml$/i.test(path) || !zip.file(path)) {
      throw new Error("Invalid PPTX slide relationship");
    }
    return path;
  });
}

export async function extractPptxText(zip: JSZip): Promise<string> {
  const texts: string[] = [];
  for (const path of (await slidePaths(zip)).slice(0, 80)) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const text = slideText(xml);
    if (text) texts.push(text);
  }
  return texts.join("\n\n");
}
