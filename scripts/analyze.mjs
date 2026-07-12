#!/usr/bin/env node
/**
 * Compute name-analysis metrics over the cleaned datasets and write
 * data/analysis.json (consumed by the web UI).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function nameStats(records, nameOf) {
  const byName = counter();
  const words = counter();
  const lastWords = counter();
  for (const r of records) {
    const name = nameOf(r);
    byName.add(name);
    const parts = name.split(/\s+/).filter(Boolean);
    for (const w of parts) words.add(w);
    if (parts.length > 1) lastWords.add(parts[parts.length - 1]);
  }
  const uniqueNames = [...byName.map.keys()];
  const sortedByLen = [...uniqueNames].sort((a, b) => len(a) - len(b) || a.localeCompare(b));
  const avgLen = uniqueNames.reduce((s, n) => s + len(n), 0) / (uniqueNames.length || 1);
  const lengthDist = counter();
  for (const n of uniqueNames) lengthDist.add(Math.min(len(n), 30));
  return {
    records: records.length,
    uniqueNames: uniqueNames.length,
    topNames: byName.top(30),
    shortest: sortedByLen.slice(0, 15).map((n) => ({ name: n, length: len(n), count: byName.map.get(n) })),
    longest: sortedByLen.slice(-15).reverse().map((n) => ({ name: n, length: len(n), count: byName.map.get(n) })),
    avgLength: +avgLen.toFixed(2),
    lengthDist: [...lengthDist.map.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
    topWords: words.top(25),
    topLastWords: lastWords.top(15),
    singletons: [...byName.map.values()].filter((c) => c === 1).length,
  };
}

function suffixStats(names, suffixes) {
  const total = names.length || 1;
  return suffixes
    .map((sfx) => {
      const matches = names.filter((n) => n.toLowerCase().endsWith(sfx));
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
    e.names.add(r.name.toLowerCase());
  }
  return [...g.values()]
    .map((e) => ({ island: e.island, atoll: e.atoll, count: e.count, unique: e.names.size }))
    .sort((a, b) => b.count - a.count);
}

function namesOnOneIslandOnly(records) {
  const islandsPerName = new Map();
  for (const r of records) {
    const k = r.name.toLowerCase();
    if (!islandsPerName.has(k)) islandsPerName.set(k, new Set());
    islandsPerName.get(k).add(r.island);
  }
  let one = 0, multi = 0;
  const widespread = [];
  for (const [name, isls] of islandsPerName) {
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
const realHouses = houses.filter((h) => h.kind === "house");
const housesSection = {
  ...nameStats(realHouses, (h) => h.name),
  allNamedBuildings: houses.length,
  bySource: {
    mbs: houses.filter((h) => h.src === "mbs").length,
    osmOnly: houses.filter((h) => h.src === "osm").length,
  },
  suffixes: suffixStats(realHouses.map((h) => h.name), ["ge", "villa", "maage", "manzil", "aage", "house", "hiya", "light", "view", "side"]),
  perIsland: perIsland(realHouses).slice(0, 25),
  islandsCovered: new Set(realHouses.map((h) => h.island)).size,
  spread: namesOnOneIslandOnly(realHouses),
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
