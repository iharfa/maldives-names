# Maldives Names

Collection and analysis of **Maldivian house names, road names, and island names**,
presented as a static dashboard.

In the Maldives, buildings traditionally carry a *house name* (e.g. *Sosunge*,
*Nooranmaage*, *Beach Villa*) rather than a street number, which makes the
country's toponyms unusually rich. This project gathers those names from open
data sources, stores them as version-controlled data files, and analyses them —
most common, shortest, longest, unique-to-one-island, common suffixes, per-island
and per-atoll breakdowns.

## Data sources

| Data | Source | License / terms |
|---|---|---|
| National address register (~92k address points with house names) | [Maldives Bureau of Statistics GIS maps](https://statisticsmaldives.gov.mv/gismaps/) (statsmap Address layer, published as qgis2web GeoJSON) | © Maldives Bureau of Statistics |
| Malé City building labels (~5.7k additional names for Malé, Hulhumalé, Villingili) | [MBS Malé City census maps](https://statisticsmaldives.gov.mv/maale-city-map/) (vector PDFs; labels extracted with `scripts/extract_pdf_labels.py`, requires Python + pdfplumber) | © Maldives Bureau of Statistics |
| House names, road names (supplementary) | [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API | [ODbL](https://www.openstreetmap.org/copyright) — © OpenStreetMap contributors |
| Roads with Dhivehi names (Malé region) | MBS statsmap Road layer | © Maldives Bureau of Statistics |
| Island registry (all ~1,560 islands, inhabited flag, atolls, Dhivehi names) | Maldives Land and Survey Authority via [onemap.mv](https://onemap.mv) (public ArcGIS FeatureServer) | © Maldives Land and Survey Authority |
| Google Maps | **Not used** | Google's Terms of Service prohibit bulk extraction/scraping of map content |

### Coverage caveat

The MBS national address register covers all administrative islands (~92k
address points), making house-name coverage close to national. OSM adds ~3k
extra named buildings not in the register. Register entries that are vacant-plot
placeholders ("Hus Goathi", "Husbin"), unit/block codes, or land-use
descriptions are classified out of the house-name analysis but kept in the
dataset (`kind` field: `house` / `vacant` / `code` / `resort` / `other`).

## Repository layout

```
scripts/collect.mjs      # fetch raw data (Overpass + onemap.mv) -> data/raw/
scripts/build-data.mjs   # normalize, classify, assign each name to an island -> data/
scripts/analyze.mjs      # compute metrics -> data/analysis.json
scripts/copy-data.mjs    # copy site data into public/data/ (Vercel build step)
data/raw/                # raw API responses (committed for reproducibility)
data/                    # cleaned datasets + analysis.json
public/                  # static dashboard (deployed to Vercel)
```

## Running the pipeline

```bash
npm run pipeline   # collect + build-data + analyze
node scripts/copy-data.mjs
# then open public/index.html via any static server (node scripts/serve.mjs)
```

Requires Node 18+. No npm dependencies.

Optional: to refresh the Malé City PDF building labels, run
`python scripts/extract_pdf_labels.py` (needs `pip install pdfplumber`) after
downloading the PDFs — its output `data/raw/mbs_pdf_labels.json` is committed,
so the Node pipeline works without Python.

## Methodology notes

- **House names** come primarily from the MBS national address register
  (`hname` per address point), plus OSM buildings with a `name` or
  `addr:housename` tag that aren't already in the register (same island + same
  name = same address). Entries that are clearly not house names — shops,
  mosques, schools, offices, vacant-plot placeholders, unit codes, land-use
  descriptions (detected via Dhivehi grammar markers like *-faivaa*) — are
  classified out but kept in the dataset.
- **Road names** are OSM ways with `highway` + `name` merged with the MBS road
  layer (which adds Dhivehi road names), deduplicated per
  `(island, lowercase name)` since one street is split into many way segments.
- **Island assignment**: MBS addresses carry their island name; where a name is
  shared by several islands the nearest same-named island centroid wins. OSM
  records use the nearest onemap.mv island centroid (haversine). For dense
  clusters (e.g. Malé region) this can very occasionally attribute a building
  to a neighbouring island.
- **Inhabited islands** are those in the onemap.mv registry with category
  `Residential Island` (189 islands as of the 2024 registry snapshot).
