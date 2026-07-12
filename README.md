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
| House names, road names | [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API | [ODbL](https://www.openstreetmap.org/copyright) — © OpenStreetMap contributors |
| Island registry (all ~1,560 islands, inhabited flag, atolls, Dhivehi names) | Maldives Land and Survey Authority via [onemap.mv](https://onemap.mv) (public ArcGIS FeatureServer) | © Maldives Land and Survey Authority |
| Google Maps | **Not used** | Google's Terms of Service prohibit bulk extraction/scraping of map content |

### Coverage caveat

OpenStreetMap completeness varies by island: Malé, Hulhumalé, Addu and other
large islands are densely mapped; many smaller islands have partial or no
house-name coverage. Counts describe *what has been mapped*, not necessarily
everything that exists on the ground.

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
# then open public/index.html via any static server
```

Requires Node 18+. No npm dependencies.

## Methodology notes

- **House names** come from OSM buildings with a `name` or `addr:housename` tag.
  Buildings tagged as shops, mosques, schools, offices, hotels etc. are collected
  but excluded from the "house names" analysis (kept in the dataset with
  `kind: "other"`).
- **Road names** are OSM ways with `highway` + `name`, deduplicated per
  `(island, lowercase name)` since one street is split into many OSM way segments.
- **Island assignment** uses the nearest onemap.mv island centroid (haversine).
  For dense clusters (e.g. Malé region) this can very occasionally attribute a
  building to a neighbouring island.
- **Inhabited islands** are those in the onemap.mv registry with category
  `Residential Island` (189 islands as of the 2024 registry snapshot).
