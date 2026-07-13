#!/usr/bin/env node
/**
 * Compute name-analysis metrics over the cleaned datasets and write
 * data/analysis.json (consumed by the web UI).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data");
const read = (f) => JSON.parse(readFileSync(join(OUT, f), "utf8"));

const islands = read("islands.json");
const houses = read("houses.json");
const roads = read("roads.json");
const osmIslands = read("osm_islands.json");
const meta = read("meta.json");

// ---------- generic helpers ----------
const counter = () => {
  const m = new Map();
  return {
    add: (k, n = 1) => m.set(k, (m.get(k) ?? 0) + n),
    top: (n) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, count]) => ({ name, count })),
    size: () => m.size,
    map: m,
  };
};

// Latin-script length (grapheme count); Dhivehi (Thaana) strings measured too
const len = (s) => [...s].length;

/**
 * Name statistics with variant-aware grouping: names are counted under their
 * normalized key (case/space/apostrophe/diacritic-insensitive — see
 * normalize.mjs), and each group is displayed as its most common spelling.
 */
function nameStats(records, nameOf) {
  const groups = new Map(); // norm key -> { count, forms: Map(surface -> count) }
  const words = counter();
  const lastWords = counter();
  for (const r of records) {
    const name = nameOf(r);
    const key = normalizeName(name);
    if (!groups.has(key)) groups.set(key, { count: 0, forms: new Map() });
    const g = groups.get(key);
    g.count++;
    g.forms.set(name, (g.forms.get(name) ?? 0) + 1);
    const parts = name.split(/\s+/).filter(Boolean);
    for (const w of parts) words.add(w);
    if (parts.length > 1) lastWords.add(parts[parts.length - 1]);
  }
  const canonical = (g) => [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const named = [...groups.values()].map((g) => ({
    name: canonical(g),
    count: g.count,
    variants: g.forms.size,
  }));
  const variantsMerged = named.reduce((s, g) => s + g.variants - 1, 0);
  const sortedByLen = [...named].sort((a, b) => len(a.name) - len(b.name) || a.name.localeCompare(b.name));
  const avgLen = named.reduce((s, g) => s + len(g.name), 0) / (named.length || 1);
  const lengthDist = counter();
  for (const g of named) lengthDist.add(Math.min(len(g.name), 30));
  const top = [...named].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    records: records.length,
    uniqueNames: named.length,
    variantsMerged,
    topNames: top.slice(0, 30).map((g) => ({ name: g.name, count: g.count, ...(g.variants > 1 ? { variants: g.variants } : {}) })),
    shortest: sortedByLen.slice(0, 15).map((g) => ({ name: g.name, length: len(g.name), count: g.count })),
    longest: sortedByLen.slice(-15).reverse().map((g) => ({ name: g.name, length: len(g.name), count: g.count })),
    avgLength: +avgLen.toFixed(2),
    lengthDist: [...lengthDist.map.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
    topWords: words.top(25),
    topLastWords: lastWords.top(15),
    singletons: named.filter((g) => g.count === 1).length,
  };
}

function suffixStats(names, suffixes) {
  const total = names.length || 1;
  return suffixes
    .map((sfx) => {
      // match on the normalized form so "Sosun ge" still counts as -ge
      const matches = names.filter((n) => normalizeName(n).endsWith(sfx));
      return { suffix: sfx, count: matches.length, pct: +((100 * matches.length) / total).toFixed(1), examples: matches.slice(0, 4) };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

function perIsland(records) {
  const g = new Map();
  for (const r of records) {
    const key = `${r.island}|${r.atoll}`;
    if (!g.has(key)) g.set(key, { island: r.island, atoll: r.atoll, count: 0, names: new Set() });
    const e = g.get(key);
    e.count++;
    e.names.add(normalizeName(r.name));
  }
  return [...g.values()]
    .map((e) => ({ island: e.island, atoll: e.atoll, count: e.count, unique: e.names.size }))
    .sort((a, b) => b.count - a.count);
}

function namesOnOneIslandOnly(records) {
  const islandsPerName = new Map();
  const display = new Map();
  for (const r of records) {
    const k = normalizeName(r.name);
    if (!islandsPerName.has(k)) islandsPerName.set(k, new Set());
    islandsPerName.get(k).add(r.island);
    display.set(k, display.get(k) ?? r.name);
  }
  let one = 0, multi = 0;
  const widespread = [];
  for (const [key, isls] of islandsPerName) {
    const name = display.get(key);
    if (isls.size === 1) one++;
    else {
      multi++;
      widespread.push({ name, islands: isls.size });
    }
  }
  widespread.sort((a, b) => b.islands - a.islands);
  return { oneIsland: one, multiIsland: multi, mostWidespread: widespread.slice(0, 20) };
}

// ---------- Houses ----------
// Four precomputed variants so the UI can toggle resort units and unit/block
// codes (e.g. "Hiyaa H16-1") on and off with checkboxes.
function buildHousesSection(records) {
  return {
    ...nameStats(records, (h) => h.name),
    suffixes: suffixStats(records.map((h) => h.name), ["ge", "villa", "maage", "manzil", "aage", "house", "hiya", "light", "view", "side"]),
    perIsland: perIsland(records).slice(0, 25),
    islandsCovered: new Set(records.map((h) => h.island)).size,
    spread: namesOnOneIslandOnly(records),
  };
}
const realHouses = houses.filter((h) => h.kind === "house");
const resortUnits = houses.filter((h) => h.kind === "resort");
const unitCodes = houses.filter((h) => h.kind === "code");
const housesSection = {
  ...buildHousesSection(realHouses),
  allNamedBuildings: houses.length,
  kindCounts: {
    house: realHouses.length,
    resort: resortUnits.length,
    code: unitCodes.length,
    vacant: houses.filter((h) => h.kind === "vacant").length,
    other: houses.filter((h) => h.kind === "other").length,
  },
  bySource: {
    mbs: houses.filter((h) => h.src === "mbs").length,
    mbsPdf: houses.filter((h) => h.src === "mbs-pdf").length,
    osmOnly: houses.filter((h) => h.src === "osm").length,
  },
  variants: {
    withResort: buildHousesSection([...realHouses, ...resortUnits]),
    withCodes: buildHousesSection([...realHouses, ...unitCodes]),
    withBoth: buildHousesSection([...realHouses, ...resortUnits, ...unitCodes]),
  },
};

// ---------- Roads ----------
const roadsSection = {
  ...nameStats(roads, (r) => r.name),
  suffixes: suffixStats(roads.map((r) => r.name), ["magu", "goalhi", "hingun", "higun", "road", "street", "path", "avenue", "lane", "gali"]),
  perIsland: perIsland(roads).slice(0, 25),
  islandsCovered: new Set(roads.map((r) => r.island)).size,
  spread: namesOnOneIslandOnly(roads),
  byHighwayType: (() => {
    const c = counter();
    for (const r of roads) c.add(r.highway);
    return c.top(12);
  })(),
};

// ---------- Islands ----------
const inhabited = islands.filter((i) => i.category === "Residential Island");
const islandNames = islands.map((i) => i.name);
const inhabitedNames = inhabited.map((i) => i.name);

const dupes = (() => {
  const c = counter();
  for (const n of islandNames) c.add(n);
  return c.top(1600).filter((e) => e.count > 1).slice(0, 25);
})();

const atollCounts = (() => {
  const c = new Map();
  for (const i of islands) {
    if (!c.has(i.atoll)) c.set(i.atoll, { atoll: i.atoll, total: 0, inhabited: 0 });
    const e = c.get(i.atoll);
    e.total++;
    if (i.category === "Residential Island") e.inhabited++;
  }
  return [...c.values()].sort((a, b) => b.total - a.total);
})();

const islandsSection = {
  registryTotal: meta.registryTotal,
  unnamed: meta.unnamedIslands,
  total: islands.length,
  inhabited: inhabited.length,
  categories: (() => {
    const c = counter();
    for (const i of islands) c.add(i.category || "Unspecified");
    return c.top(10);
  })(),
  all: nameStats(islands, (i) => i.name),
  inhabitedStats: nameStats(inhabited, (i) => i.name),
  suffixes: suffixStats(islandNames, ["fushi", "dhoo", "finolhu", "giri", "rah", "huraa", "faru", "gala", "kandu", "madivaru", "gaa", "fihalhohi", "villingili", "thila", "maa", "boli"]),
  inhabitedSuffixes: suffixStats(inhabitedNames, ["fushi", "dhoo", "finolhu", "giri", "rah", "huraa", "faru", "gaa", "maa", "gili"]),
  duplicateNames: dupes,
  atolls: atollCounts,
  inhabitedList: inhabited
    .map((i) => ({ name: i.name, nameDv: i.nameDv, atoll: i.atoll, capital: i.capital, areaHa: i.areaHa != null ? +i.areaHa.toFixed(1) : null, lat: i.lat != null ? +i.lat.toFixed(5) : null, lon: i.lon != null ? +i.lon.toFixed(5) : null }))
    .sort((a, b) => a.atoll.localeCompare(b.atoll) || a.name.localeCompare(b.name)),
  osmCrossCheck: {
    osmIslandFeatures: osmIslands.length,
    note: "OSM island/islet features with a name inside the Maldives boundary, for comparison with the official onemap.mv registry.",
  },
  mbsCrossCheck: {
    total: meta.mbsIslandsTotal,
    inhabited: meta.mbsIslandsInhabited,
    note: "Maldives Bureau of Statistics island layer (statisticsmaldives.gov.mv/gismaps): 187 islands categorised Inhabited vs 189 Residential in the onemap.mv registry.",
  },
};

const analysis = {
  generated: new Date().toISOString(),
  sources: {
    islands: "onemap.mv (Maldives Land and Survey Authority) — island_20240509 FeatureServer",
    addresses: "Maldives Bureau of Statistics national address register — statisticsmaldives.gov.mv/gismaps (statsmap Address layer)",
    housesRoads: "OpenStreetMap via Overpass API (ODbL). © OpenStreetMap contributors",
    excluded: "Google Maps (Terms of Service prohibit bulk data extraction)",
  },
  houses: housesSection,
  roads: roadsSection,
  islands: islandsSection,
};

writeFileSync(join(OUT, "analysis.json"), JSON.stringify(analysis, null, 1));
console.log("analysis.json written");
console.log(`houses: ${housesSection.records} records / ${housesSection.uniqueNames} unique`);
console.log(`roads: ${roadsSection.records} records / ${roadsSection.uniqueNames} unique`);
console.log(`islands: ${islandsSection.total} total / ${islandsSection.inhabited} inhabited`);
