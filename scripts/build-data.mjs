#!/usr/bin/env node
/**
 * Normalize raw collected data (data/raw/*) into clean datasets (data/*):
 *
 *  - islands.json  : island registry from onemap.mv (all ~1,560 islands,
 *                    category marks Residential/inhabited vs others)
 *  - houses.json   : named buildings / house names from OSM, each assigned
 *                    to its island (nearest island centroid)
 *  - roads.json    : named roads from OSM, deduplicated per (name, island)
 *  - osm_islands.json : OSM's island names for cross-checking
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw");
const OUT = join(ROOT, "data");

const read = (f) => JSON.parse(readFileSync(join(RAW, f), "utf8"));

// ---------- Islands (onemap.mv) ----------
const rawIslands = read("onemap_islands.json");
const islands = rawIslands.features
  .map((f) => {
    const a = f.attributes;
    const c = f.centroid ?? {};
    return {
      fcode: (a.FCODE || "").trim(),
      atoll: (a.atoll || "").trim(),
      name: (a.islandName || "").trim(),
      nameDv: (a.islandNa_1 || "").trim(),
      capital: (a.capital || "").trim() === "Y",
      areaHa: a.Area_ha ?? null,
      category: (a.category || "").trim(),
      sector: (a.Sector || "").trim(),
      usage: (a.Usage || "").trim(),
      lat: c.y ?? null,
      lon: c.x ?? null,
    };
  })
  .filter((i) => i.name && i.lat != null);

writeFileSync(join(OUT, "islands.json"), JSON.stringify(islands, null, 1));
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({
    registryTotal: rawIslands.features.length,
    namedIslands: islands.length,
    unnamedIslands: rawIslands.features.length - islands.length,
    islandsFetched: rawIslands.fetched ?? null,
  }, null, 1)
);
const inhabited = islands.filter((i) => i.category === "Residential Island");
console.log(`islands: ${islands.length} named of ${rawIslands.features.length} in registry, ${inhabited.length} inhabited (Residential)`);

// ---------- island assignment by nearest centroid ----------
const R = 6371; // km
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestIsland(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const isl of islands) {
    const d = haversine(lat, lon, isl.lat, isl.lon);
    if (d < bestD) {
      bestD = d;
      best = isl;
    }
  }
  return { island: best, km: bestD };
}

const coordOf = (el) => (el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center ?? null);

// ---------- Houses ----------
// Maldivian house names live either in addr:housename or in the building's name tag.
// Exclude buildings that are clearly non-residential establishments (shops, mosques,
// schools, government offices...) via tag heuristics, but keep guesthouses/apartment
// buildings since those carry traditional house names too.
const NON_HOUSE_TAGS = ["amenity", "shop", "office", "tourism", "leisure", "craft", "healthcare", "religion", "emergency", "government"];
const NON_HOUSE_BUILDING = new Set([
  "mosque", "school", "kindergarten", "hospital", "commercial", "retail", "industrial",
  "warehouse", "office", "public", "government", "civic", "stadium", "sports_centre",
  "grandstand", "greenhouse", "garage", "garages", "shed", "hut", "roof", "ruins",
  "construction", "toilets", "hangar", "storage_tank", "water_tower", "transportation",
  "train_station", "college", "university", "fire_station", "hotel", "chapel", "church", "temple",
]);

// Institutional/commercial keywords that mark a building name as not a house name
const INSTITUTIONAL = /\b(council|bank|corporation|company|pvt|ltd|school|madharusaa|mosque|miskiy|masjid|ministry|office|hospital|health|clinic|centre|center|station|court|customs|police|airport|terminal|jetty|harbour|harbor|powerhouse|power house|fenaka|stelco|mifco|stoarage|storage|warehouse|factory|workshop|showroom|shop|store|market|restaurant|cafe|hotel|guest ?house|resort|reception|spa|gym|hall|stadium|mri|wc|toilet|building|rooms|plant|association|academy|institute|campus|library|futsal|mortuary|garage)\b/i;
// Unit/block codes like "C1", "R15", "B-204", "101" — labels, not names
const UNIT_CODE = /^[A-Za-z]{0,3}[-– ]?\d+[A-Za-z]?$/;

function classifyBuilding(tags, name, islandCategory) {
  if (NON_HOUSE_BUILDING.has(tags.building)) return "other";
  for (const k of NON_HOUSE_TAGS) if (tags[k]) return "other";
  if (UNIT_CODE.test(name)) return "code";
  if (INSTITUTIONAL.test(name)) return "other";
  // Named buildings on resort islands are accommodation units, not house names
  if (islandCategory === "Tourism Island") return "resort";
  return "house";
}

const houseMap = new Map(); // key: osm type/id
for (const file of ["osm_named_buildings.json", "osm_housenames.json"]) {
  for (const el of read(file).elements) {
    const tags = el.tags ?? {};
    const name = (tags["addr:housename"] || tags.name || "").trim();
    const co = coordOf(el);
    if (!name || !co) continue;
    const key = `${el.type}/${el.id}`;
    if (houseMap.has(key)) continue;
    houseMap.set(key, { el, tags, name, co });
  }
}

const houses = [];
for (const { el, tags, name, co } of houseMap.values()) {
  const { island, km } = nearestIsland(co.lat, co.lon);
  houses.push({
    name,
    kind: classifyBuilding(tags, name, island.category),
    building: tags.building ?? null,
    island: island.name,
    atoll: island.atoll,
    islandCategory: island.category,
    addrCity: tags["addr:city"] ?? null,
    street: tags["addr:street"] ?? null,
    lat: +co.lat.toFixed(6),
    lon: +co.lon.toFixed(6),
    osm: `${el.type}/${el.id}`,
    distKm: +km.toFixed(2),
  });
}
writeFileSync(join(OUT, "houses.json"), JSON.stringify(houses));
console.log(`houses: ${houses.length} named buildings (${houses.filter((h) => h.kind === "house").length} classified residential)`);

// ---------- Roads ----------
// OSM splits one street into many way segments; dedupe by (island, lowercase name).
const roadGroups = new Map();
for (const el of read("osm_roads.json").elements) {
  const tags = el.tags ?? {};
  const name = (tags.name || "").trim();
  const co = coordOf(el);
  if (!name || !co) continue;
  const { island } = nearestIsland(co.lat, co.lon);
  const key = `${island.fcode}|${name.toLowerCase()}`;
  if (!roadGroups.has(key)) {
    roadGroups.set(key, {
      name,
      nameDv: tags["name:dv"] ?? null,
      island: island.name,
      atoll: island.atoll,
      islandCategory: island.category,
      highway: tags.highway,
      segments: 0,
      lat: +co.lat.toFixed(6),
      lon: +co.lon.toFixed(6),
    });
  }
  roadGroups.get(key).segments++;
}
const roads = [...roadGroups.values()];
writeFileSync(join(OUT, "roads.json"), JSON.stringify(roads));
console.log(`roads: ${roads.length} distinct (island, name) streets`);

// ---------- OSM island names (cross-check) ----------
const osmIslands = read("osm_islands.json").elements
  .map((el) => {
    const co = coordOf(el);
    return co
      ? { name: (el.tags.name || "").trim(), nameEn: el.tags["name:en"] ?? null, place: el.tags.place, lat: +co.lat.toFixed(5), lon: +co.lon.toFixed(5) }
      : null;
  })
  .filter(Boolean);
writeFileSync(join(OUT, "osm_islands.json"), JSON.stringify(osmIslands));
console.log(`osm islands: ${osmIslands.length}`);
