export type NearBoxCharacter = {
  destroy: () => void;
  setState: (name: string, opts?: { resetEyes?: boolean }) => void;
  setInk: (color: string) => void;
  setEyeColor: (color: string) => void;
};

export type NearBoxCharacterCtor = new (
  svg: SVGSVGElement,
  opts?: Record<string, unknown>,
) => NearBoxCharacter;

export function getNearBoxCharacter(): NearBoxCharacterCtor;
