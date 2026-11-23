import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";

interface EditEffect {
  id: string;
  name: string;
  use: string;
  inputs: string;
  duration: string;
  required: string[];
  thumbnail: string | null;
}

export const editEffects = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "assets/edit-effects/catalog.json"), "utf8"),
) as EditEffect[];

export function findEditEffect(id: string) {
  return editEffects.find((effect) => effect.id === id);
}
