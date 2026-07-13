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

// qgis2web layer files are `var json_X = {...GeoJSON...};`
const readMbs = (f) => {
  const txt = readFileSync(join(RAW, f), "utf8");
  return JSON.parse(txt.slice(txt.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
};

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

function nearestIsland(lat, lon, candidates = islands) {
  let best = null;
  let bestD = Infinity;
  for (const isl of candidates) {
    const d = haversine(lat, lon, isl.lat, isl.lon);
    if (d < bestD) {
      bestD = d;
      best = isl;
    }
  }
  return { island: best, km: bestD };
}

// islands indexed by lowercase name (island names repeat across atolls)
const islandsByName = new Map();
for (const isl of islands) {
  const k = isl.name.toLowerCase();
  if (!islandsByName.has(k)) islandsByName.set(k, []);
  islandsByName.get(k).push(isl);
}

// Resolve an island from the MBS register's own IslandName + coordinates:
// prefer same-named islands (nearest if the name is shared), else global nearest.
function resolveIsland(islandName, lat, lon) {
  const candidates = islandsByName.get((islandName || "").toLowerCase());
  if (candidates?.length) return nearestIsland(lat, lon, candidates).island;
  return nearestIsland(lat, lon).island;
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
const INSTITUTIONAL = /\b(council|bank|corporation|company|pvt|ltd|school|madharusaa|mosque|miskiy|masjid|ministry|office|hospital|health|clinic|centre|center|station|court|customs|police|airport|terminal|jetty|harbour|harbor|powerhouse|power house|fenaka|stelco|mifco|stoarage|storage|warehouse|factory|workshop|showroom|shop|store|market|restaurant|cafe|hotel|guest ?house|resort|reception|spa|gym|hall|stadium|mri|wc|toilet|building|rooms|plant|association|academy|institute|campus|library|futsal|mortuary|garage|proposed|reserved|under construction|housing units?|sqft|land use|waste|cemetery|qabrusthan|kulhivaru|park|beach area|picnic|fihaara|gudhan|hardware|pharmacy|salon|corner ?shop)\b/i;
// Unit/block codes like "C1", "R15", "B-204", "101" — labels, not names
const UNIT_CODE = /^[A-Za-z]{0,3}[-– ]?\d+[A-Za-z]?$/;
// Vacant-plot placeholders in the national register: "Hus Goathi" (empty plot),
// "Husbin"/"Hus Bin" (empty land), bare "Goathi"/"Bin" (plot/land), often numbered
const VACANT = /^\s*(hus\s*(goathi|bin)|husbin|husgoathi|goathi|bin)\s*(no\.?\s*)?[\d-]*\s*$/i;

function classifyBuilding(tags, name, islandCategory) {
  if (NON_HOUSE_BUILDING.has(tags.building)) return "other";
  for (const k of NON_HOUSE_TAGS) if (tags[k]) return "other";
  if (VACANT.test(name)) return "vacant";
  if (UNIT_CODE.test(name)) return "code";
  // no run of 2+ letters (Latin or Thaana) => a label like "E", "??", "7-2";
  // 1-2 character names ("CR", "GA") are block/plot codes, not house names
  if (!/[A-Za-zހ-޿]{2}/.test(name) || [...name].length < 3) return "code";
  if (INSTITUTIONAL.test(name)) return "other";
  // register entries longer than ~60 chars, with 5+ words, or with parentheses
  // are administrative descriptions ("plot allocated in exchange for…"), not names
  if ([...name].length > 60 || name.split(/\s+/).length >= 5 || /[()]/.test(name)) return "other";
  // latinised Dhivehi grammar/vocabulary that marks land-use descriptions rather
  // than names: participles like -faivaa ("designated"), beynumah ("for the use
  // of"), miskih/gaburusthan (mosque/cemetery), binthah ("plots of land")…
  if (/faivaa|kurevi|dhookur|beynumah|masakkath|hurithan|miski[ht]|gaburusthan|binthah|hidhumaiy|sarahahdh|kandaelhi|goachah|imaaraai|madharusa|dhanduverikan|janavaaru|masverikam|usoolun|nizamuge|marukaz/i.test(name))
    return "other";
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

// Primary source: the MBS national address register (~92k address points).
// Each point carries its island name directly.
const mbsAddresses = readMbs("Address_24.js");
const mbsKeys = new Set();
for (const ft of mbsAddresses.features) {
  const name = (ft.properties?.hname || "").trim();
  const [lon, lat] = ft.geometry?.coordinates ?? [];
  if (!name || lat == null) continue;
  const island = resolveIsland(ft.properties.IslandName, lat, lon);
  mbsKeys.add(`${island.name}|${name.toLowerCase()}`);
  houses.push({
    name,
    kind: classifyBuilding({}, name, island.category),
    src: "mbs",
    island: island.name,
    atoll: island.atoll,
    islandCategory: island.category,
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
  });
}
const mbsCount = houses.length;

// Secondary source: OSM named buildings not already present in the register
// (same island + same name = same address; skip to avoid double counting).
let osmDupes = 0;
for (const { el, tags, name, co } of houseMap.values()) {
  const { island, km } = nearestIsland(co.lat, co.lon);
  if (mbsKeys.has(`${island.name}|${name.toLowerCase()}`)) {
    osmDupes++;
    continue;
  }
  houses.push({
    name,
    kind: classifyBuilding(tags, name, island.category),
    src: "osm",
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
// Third source: building labels extracted from the MBS Malé City census map
// PDFs (statisticsmaldives.gov.mv/maale-city-map — see extract_pdf_labels.py).
// Island is known per PDF; FCODE from the map titles pins the exact island.
const PDF_ISLAND_FCODE = { "Malé": "LD0442", "Hulhumalé": "LD0591", "Villingili": "LD0268" };
let pdfAdded = 0, pdfDupes = 0;
try {
  const pdfLabels = read("mbs_pdf_labels.json");
  const byFcode = new Map(islands.map((i) => [i.fcode, i]));
  for (const [islandName, labels] of Object.entries(pdfLabels)) {
    const island = byFcode.get(PDF_ISLAND_FCODE[islandName]);
    if (!island) continue;
    const seen = new Set();
    for (let name of labels) {
      name = name.replace(/\s*\(LD\d+\)\s*/g, "").trim();
      // skip the map's own title label ("Maale", "Hulhumaale", "Villingili")
      if (!name || name.toLowerCase().replace(/[eé]/g, "e") === island.name.toLowerCase().replace(/[eé]/g, "e") || /^(maale|hulhumaale|villingili)$/i.test(name)) continue;
      const key = `${island.name}|${name.toLowerCase()}`;
      if (mbsKeys.has(key) || seen.has(key)) {
        pdfDupes++;
        continue;
      }
      seen.add(key);
      houses.push({
        name,
        kind: classifyBuilding({}, name, island.category),
        src: "mbs-pdf",
        island: island.name,
        atoll: island.atoll,
        islandCategory: island.category,
      });
      pdfAdded++;
    }
  }
} catch (e) {
  console.warn(`mbs_pdf_labels.json not available (${e.message}) — skipping PDF source`);
}
console.log(`pdf labels: ${pdfAdded} added, ${pdfDupes} already known`);

writeFileSync(join(OUT, "houses.json"), JSON.stringify(houses));
console.log(
  `houses: ${houses.length} named buildings — ${mbsCount} MBS register, ${pdfAdded} census-map PDFs, ${houses.filter((h) => h.src === "osm").length} OSM-only (${osmDupes} OSM dupes skipped), ${houses.filter((h) => h.kind === "house").length} classified residential`
);

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
      src: "osm",
      segments: 0,
      lat: +co.lat.toFixed(6),
      lon: +co.lon.toFixed(6),
    });
  }
  roadGroups.get(key).segments++;
}

// MBS statsmap road layer (Malé-region official roads, with Dhivehi names)
const firstCoord = (geom) => {
  let c = geom?.coordinates;
  while (Array.isArray(c?.[0])) c = c[0];
  return Array.isArray(c) && c.length >= 2 ? c : null;
};
for (const ft of readMbs("Road_9.js").features) {
  const name = (ft.properties?.roadEN || "").trim();
  const co = firstCoord(ft.geometry);
  if (!name || !co) continue;
  const [lon, lat] = co;
  const { island } = nearestIsland(lat, lon);
  const key = `${island.fcode}|${name.toLowerCase()}`;
  if (roadGroups.has(key)) {
    const g = roadGroups.get(key);
    g.src = "both";
    if (!g.nameDv && ft.properties.roadDI) g.nameDv = ft.properties.roadDI.trim();
    g.segments++;
  } else {
    roadGroups.set(key, {
      name,
      nameDv: (ft.properties.roadDI || "").trim() || null,
      island: island.name,
      atoll: island.atoll,
      islandCategory: island.category,
      highway: "road",
      src: "mbs",
      segments: 1,
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
    });
  }
}
const roads = [...roadGroups.values()];
writeFileSync(join(OUT, "roads.json"), JSON.stringify(roads));
console.log(`roads: ${roads.length} distinct (island, name) streets`);

// ---------- MBS island layer (cross-check + inhabited categories) ----------
const mbsIslands = readMbs("IslandName_23.js").features.map((ft) => ({
  fcode: ft.properties.FCODE,
  name: ft.properties.IslandName,
  atollCode: ft.properties.Atoll,
  category: ft.properties.category,
  capital: ft.properties.capital === "Y",
  lat: ft.properties.latitude,
  lon: ft.properties.longitude,
}));
writeFileSync(join(OUT, "mbs_islands.json"), JSON.stringify(mbsIslands));
console.log(
  `mbs islands: ${mbsIslands.length} (${mbsIslands.filter((i) => i.category === "Inhabited").length} inhabited)`
);

// ---------- OSM island names (cross-check) ----------
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({
    registryTotal: rawIslands.features.length,
    namedIslands: islands.length,
    unnamedIslands: rawIslands.features.length - islands.length,
    islandsFetched: rawIslands.fetched ?? null,
    housesMbs: mbsCount,
    housesPdf: pdfAdded,
    housesOsmOnly: houses.filter((h) => h.src === "osm").length,
    osmDupesSkipped: osmDupes,
    mbsIslandsTotal: mbsIslands.length,
    mbsIslandsInhabited: mbsIslands.filter((i) => i.category === "Inhabited").length,
  }, null, 1)
);

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
