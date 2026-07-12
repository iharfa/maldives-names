#!/usr/bin/env node
/**
 * Data collection for Maldives Names project.
 *
 * Sources:
 *  1. onemap.mv (Maldives Land and Survey Authority) — island registry via its
 *     public ArcGIS FeatureServer (island polygons layer, attributes + centroids).
 *  2. OpenStreetMap via Overpass API — named buildings (house names),
 *     addr:housename tags, named highways (road names), and place=island nodes.
 *  3. Maldives Bureau of Statistics GIS maps (statisticsmaldives.gov.mv/gismaps)
 *     — the national address register (~92k address points with house names),
 *     roads with Dhivehi names, and an island layer with inhabited categories.
 *     These are published as qgis2web GeoJSON-in-JS layer files.
 *
 * Google Maps is intentionally NOT used: its Terms of Service prohibit bulk
 * extraction/scraping of map content and it offers no API for downloading
 * all place names in a region.
 *
 * Output: JSON files under data/raw/
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw");
mkdirSync(RAW, { recursive: true });

const MALDIVES_AREA = 3600536773; // OSM relation 536773 (Maldives) as Overpass area

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      process.stderr.write(`[overpass] ${label}: attempt ${attempt + 1} via ${new URL(url).host}\n`);
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "maldives-names-research/1.0 (data study of Maldivian toponyms)" },
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) {
        const json = JSON.parse(text);
        if (Array.isArray(json.elements)) return json;
      }
      process.stderr.write(`[overpass] ${label}: non-JSON/busy response (${res.status}), retrying\n`);
    } catch (err) {
      process.stderr.write(`[overpass] ${label}: ${err.message}\n`);
    }
    await sleep(15000 + attempt * 10000);
  }
  throw new Error(`Overpass query failed after retries: ${label}`);
}

async function fetchIslands() {
  const base =
    "https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/island_20240509/FeatureServer/0/query";
  const fields = "FCODE,atoll,islandName,capital,islandNa_1,Area_ha,category,Sector,Usage";
  const all = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: fields,
      returnGeometry: "false",
      returnCentroid: "true",
      outSR: "4326",
      f: "json",
      resultRecordCount: "1000",
      resultOffset: String(offset),
    });
    const res = await fetch(`${base}?${params}`);
    const json = await res.json();
    const feats = json.features ?? [];
    all.push(...feats);
    process.stderr.write(`[onemap] islands: ${all.length} fetched\n`);
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  writeFileSync(join(RAW, "onemap_islands.json"), JSON.stringify({ fetched: new Date().toISOString(), features: all }, null, 1));
  return all;
}

const QUERIES = {
  // Buildings with a name — in the Maldives, house names are usually mapped as
  // the building's `name` tag. Full tags kept so we can classify buildings later.
  osm_named_buildings: `[out:json][timeout:300];area(${MALDIVES_AREA})->.mv;nwr["building"]["name"](area.mv);out tags center;`,
  // Explicit addr:housename tags (used less often but authoritative when present)
  osm_housenames: `[out:json][timeout:300];area(${MALDIVES_AREA})->.mv;nwr["addr:housename"](area.mv);out tags center;`,
  // Named roads/streets/paths
  osm_roads: `[out:json][timeout:300];area(${MALDIVES_AREA})->.mv;way["highway"]["name"](area.mv);out tags center;`,
  // Anything carrying an addr:street tag — captures street names referenced by
  // addresses even where the street itself is unnamed in OSM
  osm_addr_streets: `[out:json][timeout:300];area(${MALDIVES_AREA})->.mv;nwr["addr:street"](area.mv);out tags center;`,
  // OSM's own view of island names, for cross-checking against onemap.mv
  osm_islands: `[out:json][timeout:300];area(${MALDIVES_AREA})->.mv;nwr["place"~"^(island|islet)$"]["name"](area.mv);out tags center;`,
};

const MBS_LAYERS = ["Address_24", "Road_9", "IslandName_23"];

async function fetchMbsLayers() {
  for (const layer of MBS_LAYERS) {
    const url = `https://statisticsmaldives.gov.mv/gismaps/statsmap/layers/${layer}.js`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (maldives-names research)" } });
    if (!res.ok) throw new Error(`MBS layer ${layer}: HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(join(RAW, `${layer}.js`), text);
    process.stderr.write(`[mbs] ${layer}: ${text.length} bytes\n`);
  }
}

async function main() {
  const only = process.argv.slice(2); // optionally run a subset: node collect.mjs osm_roads
  if (only.length === 0 || only.includes("islands")) {
    await fetchIslands();
  }
  if (only.length === 0 || only.includes("mbs")) {
    await fetchMbsLayers();
  }
  for (const [name, query] of Object.entries(QUERIES)) {
    if (only.length > 0 && !only.includes(name) && !only.includes("osm")) continue;
    const json = await overpass(query, name);
    writeFileSync(join(RAW, `${name}.json`), JSON.stringify(json));
    process.stderr.write(`[done] ${name}: ${json.elements.length} elements\n`);
    await sleep(10000); // be polite between queries
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
