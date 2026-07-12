#!/usr/bin/env node
/**
 * Prepare public/data/ for the site:
 *  - copy analysis.json, roads.json, islands.json as-is
 *  - write houses.min.json, a compact form of the ~94k-record houses dataset
 *    (an island lookup table + one small tuple per record) so the Explore tab
 *    stays fast to download.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(ROOT, "public", "data");
mkdirSync(dest, { recursive: true });

for (const f of ["analysis.json", "roads.json", "islands.json"]) {
  copyFileSync(join(ROOT, "data", f), join(dest, f));
  console.log(`copied ${f}`);
}

const houses = JSON.parse(readFileSync(join(ROOT, "data", "houses.json"), "utf8"));
const islandIndex = new Map();
const islandList = [];
const rows = houses.map((h) => {
  const key = `${h.island}|${h.atoll}`;
  if (!islandIndex.has(key)) {
    islandIndex.set(key, islandList.length);
    islandList.push([h.island, h.atoll]);
  }
  // [name, islandIdx, kind, src]
  return [h.name, islandIndex.get(key), h.kind[0], h.src];
});
writeFileSync(join(dest, "houses.min.json"), JSON.stringify({ islands: islandList, rows }));
console.log(`wrote houses.min.json (${rows.length} rows, ${islandList.length} islands)`);
