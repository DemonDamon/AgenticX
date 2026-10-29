import type { KnowledgeObjectRow, QualityFindingRow } from "./knowledge-lifecycle-types";
import { SAMPLE_QUALITY_POLICY } from "./knowledge-lifecycle-types";

type Policy = typeof SAMPLE_QUALITY_POLICY;

function attrPath(obj: KnowledgeObjectRow, path: string): unknown {
  if (path.startsWith("attrs.")) return obj.attrs[path.slice("attrs.".length)];
  if (path === "kind") return obj.kind;
  if (path === "id") return obj.id;
  return obj.meta[path];
}

/** Minimal TS port of agenticx.knowledge.lifecycle.quality.run_quality_checks. */
export function runQualityChecks(
  objects: KnowledgeObjectRow[],
  policy?: Partial<Policy>,
): QualityFindingRow[] {
  const pol: Policy = { ...SAMPLE_QUALITY_POLICY, ...(policy || {}) };
  const byId = new Map(objects.map((o) => [o.id, o]));
  const findings: QualityFindingRow[] = [];

  for (const o of objects) {
    if (pol.require_source_ids && (!o.source_ids || o.source_ids.length === 0)) {
      findings.push({
        code: "id_link",
        severity: "error",
        object_id: o.id,
        message: "missing source_ids for identifier linkage",
        detail: { kind: o.kind },
      });
    } else if ((!o.source_ids || o.source_ids.length === 0) && o.meta.expect_sources) {
      findings.push({
        code: "id_link",
        severity: "warning",
        object_id: o.id,
        message: "expected source_ids but none set",
        detail: { kind: o.kind },
      });
    }

    const needed = pol.required_attrs[o.kind] ?? [];
    const missing = needed.filter((k) => o.attrs[k] === undefined || o.attrs[k] === "");
    if (missing.length) {
      findings.push({
        code: "required_attrs",
        severity: "error",
        object_id: o.id,
        message: `missing required attrs: ${missing.join(", ")}`,
        detail: { missing, kind: o.kind },
      });
    }

    if (pol.relation_targets_must_exist) {
      for (const rel of o.relations) {
        const target = String(rel.target_id ?? "").trim();
        if (!target) {
          findings.push({
            code: "relation_integrity",
            severity: "error",
            object_id: o.id,
            message: "relation missing target_id",
            detail: { rel },
          });
        } else if (!byId.has(target)) {
          findings.push({
            code: "relation_integrity",
            severity: "error",
            object_id: o.id,
            message: `relation target not found: ${target}`,
            detail: { rel: rel.rel, target_id: target },
          });
        } else {
          const tgt = byId.get(target)!;
          if (pol.stale_if_status.includes(tgt.status)) {
            findings.push({
              code: "stale",
              severity: "warning",
              object_id: o.id,
              message: `relation points to ${tgt.status} object ${target}`,
              detail: { target_id: target, target_status: tgt.status },
            });
          }
        }
      }
    }
  }

  const keys = pol.duplicate_keys || [];
  if (keys.length) {
    const groups = new Map<string, string[]>();
    for (const o of objects) {
      const parts: string[] = [];
      let skip = false;
      for (const k of keys) {
        const v = attrPath(o, k);
        if (v === undefined || v === null || v === "") {
          skip = true;
          break;
        }
        parts.push(`${k}=${String(v)}`);
      }
      if (skip) continue;
      const key = parts.join("|");
      const list = groups.get(key) ?? [];
      list.push(o.id);
      groups.set(key, list);
    }
    for (const [key, ids] of groups) {
      if (ids.length < 2) continue;
      for (const oid of ids) {
        findings.push({
          code: "duplicate",
          severity: "warning",
          object_id: oid,
          message: `duplicate key group size=${ids.length}`,
          detail: { keys: key, peers: ids.filter((i) => i !== oid) },
        });
      }
    }
  }

  const bySource = new Map<string, string[]>();
  for (const o of objects) {
    for (const sid of o.source_ids) {
      const list = bySource.get(sid) ?? [];
      list.push(o.id);
      bySource.set(sid, list);
    }
  }
  for (const [sid, ids] of bySource) {
    const uniq = [...new Set(ids)].sort();
    if (uniq.length < 2) continue;
    for (const oid of uniq) {
      findings.push({
        code: "conflict",
        severity: "error",
        object_id: oid,
        message: `source_id '${sid}' linked to multiple objects`,
        detail: { source_id: sid, peers: uniq.filter((i) => i !== oid) },
      });
    }
  }

  findings.sort((a, b) =>
    a.object_id === b.object_id
      ? a.code === b.code
        ? a.message.localeCompare(b.message)
        : a.code.localeCompare(b.code)
      : a.object_id.localeCompare(b.object_id),
  );
  return findings;
}
