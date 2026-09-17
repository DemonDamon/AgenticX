import "../../../../examples/sunny-box-bot/engine/geometry-data.js";
import "../../../../examples/sunny-box-bot/engine/src/math.js";
import "../../../../examples/sunny-box-bot/engine/src/tables.js";
import "../../../../examples/sunny-box-bot/engine/src/pose.js";
import "../../../../examples/sunny-box-bot/engine/src/tricks.js";
import "../../../../examples/sunny-box-bot/engine/src/fx.js";
import "../../../../examples/sunny-box-bot/engine/src/eyes.js";
import "../../../../examples/sunny-box-bot/engine/src/character.js";

export function getNearBoxCharacter() {
  const Ctor = window.GrokCharacter;
  if (typeof Ctor !== "function") {
    throw new Error("near-box engine missing");
  }
  return Ctor;
}
