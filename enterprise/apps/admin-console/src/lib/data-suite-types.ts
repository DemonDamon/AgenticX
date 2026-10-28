import { SAMPLE_BOARD, type BoardSpec } from "./data-board-fixture";

export type DictionaryField = {
  name: string;
  business_def: string;
  calc_logic: string;
  update_freq: string;
  owner: string;
};

/** Seed fields mirrored from data-governance SAMPLE_FIELDS / sample_dictionary.yaml. */
export const SAMPLE_DICTIONARY_FIELDS: DictionaryField[] = [
  {
    name: "member_id",
    business_def: "Stable member primary key after OneID merge",
    calc_logic: "idmapping.merge primary",
    update_freq: "daily",
    owner: "data-platform",
  },
  {
    name: "mobile_hash",
    business_def: "Hashed mobile used as ID edge",
    calc_logic: "sha256(mobile_e164)",
    update_freq: "daily",
    owner: "data-platform",
  },
];

export type { BoardSpec };
export { SAMPLE_BOARD };
