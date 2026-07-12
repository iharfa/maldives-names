#!/usr/bin/env node
/** Copy the cleaned data files the site needs into public/data/. */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(ROOT, "public", "data");
mkdirSync(dest, { recursive: true });
for (const f of ["analysis.json", "houses.json", "roads.json", "islands.json"]) {
  copyFileSync(join(ROOT, "data", f), join(dest, f));
  console.log(`copied ${f}`);
}
