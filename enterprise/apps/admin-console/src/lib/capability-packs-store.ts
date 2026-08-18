import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/capability-packs-store";
import * as postgresql from "./db-stores/postgresql/capability-packs-store";

export type * from "./db-stores/postgresql/capability-packs-store";
export {
  assertCapabilityIds,
  normalizeAssignmentKeys,
} from "./db-stores/postgresql/capability-packs-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listSkills: typeof postgresql.listSkills = (...args) => implementation().listSkills(...args);
export const getSkill: typeof postgresql.getSkill = (...args) => implementation().getSkill(...args);
export const createSkill: typeof postgresql.createSkill = (...args) => implementation().createSkill(...args);
export const updateSkill: typeof postgresql.updateSkill = (...args) => implementation().updateSkill(...args);
export const deleteSkill: typeof postgresql.deleteSkill = (...args) => implementation().deleteSkill(...args);

export const listCapabilityPacks: typeof postgresql.listCapabilityPacks = (...args) =>
  implementation().listCapabilityPacks(...args);
export const getCapabilityPack: typeof postgresql.getCapabilityPack = (...args) =>
  implementation().getCapabilityPack(...args);
export const createCapabilityPack: typeof postgresql.createCapabilityPack = (...args) =>
  implementation().createCapabilityPack(...args);
export const updateCapabilityPack: typeof postgresql.updateCapabilityPack = (...args) =>
  implementation().updateCapabilityPack(...args);
export const deleteCapabilityPack: typeof postgresql.deleteCapabilityPack = (...args) =>
  implementation().deleteCapabilityPack(...args);
