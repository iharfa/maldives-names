/* Maldives Names — dashboard renderer (vanilla JS, no dependencies) */
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US");

  // ---------- tabs ----------
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    for (const b of $("#tabs").children) b.classList.toggle("active", b === btn);
    for (const s of document.querySelectorAll("section.tab"))
      s.classList.toggle("active", s.id === `tab-${btn.dataset.tab}`);
    if (btn.dataset.tab === "explore") ensureExplore();
  });

  // ---------- tiny chart builders ----------
  function barList(items, { labelKey = "name", valueKey = "count", max = null, title = null } = {}) {
    const mx = max ?? Math.max(...items.map((d) => d[valueKey]), 1);
    return `<div class="bars">${items
      .map(
        (d) => `<div class="bar-row" title="${esc(d[labelKey])}: ${fmt(d[valueKey])}">
          <span class="lbl">${esc(d[labelKey])}</span>
          <span class="track"><span class="fill" style="width:${((100 * d[valueKey]) / mx).toFixed(1)}%"></span></span>
          <span class="val">${fmt(d[valueKey])}</span>
        </div>`
      )
      .join("")}</div>`;
  }

  function columns(dist) {
    const mx = Math.max(...dist.map((d) => d.count), 1);
    const cols = dist
      .map(
        (d) =>
          `<div class="c" style="height:${((100 * d.count) / mx).toFixed(1)}%">
             <span class="tip">${d.length}${d.length >= 30 ? "+" : ""} chars — ${fmt(d.count)} names</span>
           </div>`
      )
      .join("");
    const ticks = dist.map((d, i) => `<span>${i % 5 === 0 ? d.length : ""}</span>`).join("");
    return `<div class="cols">${cols}</div><div class="cols-x">${ticks}</div>`;
  }

  function kpi(value, label) {
    return `<div class="kpi"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;
  }

  function card(title, note, body) {
    return `<div class="card"><h3>${esc(title)}</h3>${note ? `<p class="note">${esc(note)}</p>` : ""}${body}</div>`;
  }

  function extremesTable(rows) {
    return `<table class="data"><thead><tr><th>Name</th><th class="num">Length</th><th class="num">Occurrences</th></tr></thead>
      <tbody>${rows
        .map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.length}</td><td class="num">${fmt(r.count)}</td></tr>`)
        .join("")}</tbody></table>`;
  }

  function suffixTable(sfx) {
    return `<table class="data"><thead><tr><th>Ending</th><th class="num">Names</th><th class="num">Share</th><th>Examples</th></tr></thead>
      <tbody>${sfx
        .map(
          (s) => `<tr><td>-${esc(s.suffix)}</td><td class="num">${fmt(s.count)}</td><td class="num">${s.pct}%</td>
            <td>${s.examples.map((e) => `<span class="pill">${esc(e)}</span>`).join("")}</td></tr>`
        )
        .join("")}</tbody></table>`;
  }

  // ---------- section renderers ----------
  function renderNameSection(el, S, opts) {
    el.innerHTML = `
      <div class="kpis">
        ${kpi(fmt(S.records), opts.recordsLabel)}
        ${kpi(fmt(S.uniqueNames), "unique names")}
        ${kpi(fmt(S.islandsCovered ?? 0), "islands covered")}
        ${kpi(S.avgLength, "avg name length")}
        ${kpi(fmt(S.singletons), "names used exactly once")}
      </div>
      <div class="grid2">
        ${card(`Most common ${opts.noun}`, `Top ${S.topNames.length} by number of occurrences nationwide`, barList(S.topNames.slice(0, 20)))}
        <div>
          ${card("Shortest names", "Shortest distinct names in the dataset", extremesTable(S.shortest.slice(0, 8)))}
          ${card("Longest names", "Longest distinct names in the dataset", extremesTable(S.longest.slice(0, 8)))}
        </div>
      </div>
      <div class="grid2">
        ${card("Name length distribution", "Distinct names by character count (30 = 30 or more)", columns(S.lengthDist))}
        ${card("Common endings", "Traditional suffixes and their share of all distinct names", suffixTable(S.suffixes.slice(0, 8)))}
      </div>
      <div class="grid2">
        ${card("Islands with the most " + opts.noun, "Named records per island (top 15)", barList(S.perIsland.slice(0, 15).map((p) => ({ name: `${p.island} (${p.atoll})`, count: p.count }))))}
        ${card(
          "Most widespread names",
          "Names that appear on the largest number of different islands",
          `<table class="data"><thead><tr><th>Name</th><th class="num">Islands</th></tr></thead><tbody>${S.spread.mostWidespread
            .slice(0, 12)
            .map((w) => `<tr><td>${esc(w.name)}</td><td class="num">${w.islands}</td></tr>`)
            .join("")}</tbody></table>
           <p class="note" style="margin-top:10px">${fmt(S.spread.oneIsland)} names appear on a single island only; ${fmt(
             S.spread.multiIsland
           )} appear on more than one.</p>`
        )}
      </div>
      ${opts.extra ?? ""}`;
  }

  function renderHousesTab(A) {
    const tab = $("#tab-houses");
    tab.innerHTML = `
      <div class="controls" style="align-items:center">
        <label style="display:flex;gap:6px;align-items:center;font-size:13.5px;color:var(--ink-2)">
          <input type="checkbox" id="inc-resort"> Include resort &amp; guesthouse units (${fmt(A.houses.kindCounts?.resort ?? 0)})
        </label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13.5px;color:var(--ink-2)">
          <input type="checkbox" id="inc-codes"> Include block &amp; unit codes, e.g. “Hiyaa H16-1” (${fmt(A.houses.kindCounts?.code ?? 0)})
        </label>
      </div>
      <div id="houses-body"></div>`;
    const note = `<p class="note" style="color:var(--muted);font-size:12.5px">Sources: ${fmt(
      A.houses.bySource?.mbs ?? 0
    )} addresses from the Maldives Bureau of Statistics national address register, ${fmt(
      A.houses.bySource?.mbsPdf ?? 0
    )} building labels from the MBS Malé City census map PDFs, plus ${fmt(
      A.houses.bySource?.osmOnly ?? 0
    )} OpenStreetMap-only records. Shops, mosques, schools, offices, vacant-plot placeholders and land-use descriptions are always excluded. Spelling variants (case, spaces, apostrophes — “Beach Villa” / “Beachvilla”) are counted as one name and shown under their most common spelling.</p>`;
    const render = () => {
      const r = $("#inc-resort").checked;
      const c = $("#inc-codes").checked;
      const S = r && c ? A.houses.variants.withBoth : r ? A.houses.variants.withResort : c ? A.houses.variants.withCodes : A.houses;
      renderNameSection($("#houses-body"), S, {
        recordsLabel: "named buildings (residential)" + (r || c ? " + included extras" : ""),
        noun: "house names",
        extra: note,
      });
    };
    $("#inc-resort").addEventListener("change", render);
    $("#inc-codes").addEventListener("change", render);
    render();
  }

  function renderOverview(A) {
    $("#tab-overview").innerHTML = `
      <div class="kpis">
        ${kpi(fmt(A.houses.records), "house names collected")}
        ${kpi(fmt(A.roads.records), "distinct named roads")}
        ${kpi(fmt(A.islands.registryTotal), "islands in registry")}
        ${kpi(fmt(A.islands.inhabited), "inhabited islands")}
      </div>
      <div class="grid2">
        ${card("Most common house names", "Across all mapped islands", barList(A.houses.topNames.slice(0, 10)))}
        ${card("Most common road names", "Across all mapped islands", barList(A.roads.topNames.slice(0, 10)))}
      </div>
      <div class="grid2">
        ${card("Island name endings", "Traditional toponymic suffixes across all 1,500+ islands", suffixTable(A.islands.suffixes.slice(0, 6)))}
        ${card(
          "About the data",
          "",
          `<table class="data"><tbody>
            <tr><td>Addresses / house names</td><td>Maldives Bureau of Statistics national address register (statisticsmaldives.gov.mv/gismaps) + OpenStreetMap</td></tr>
            <tr><td>Road names</td><td>OpenStreetMap (Overpass API) + MBS road layer</td></tr>
            <tr><td>Island registry</td><td>onemap.mv — Maldives Land and Survey Authority</td></tr>
            <tr><td>House name convention</td><td>Maldivian buildings traditionally carry a house name (e.g. <em>Sosunge</em>, <em>Nooranmaage</em>) instead of a street number — OSM maps these as building names.</td></tr>
            <tr><td>Google Maps</td><td>Not included: bulk extraction is prohibited by its Terms of Service.</td></tr>
          </tbody></table>`
        )}
      </div>`;
  }

  function renderIslands(A) {
    const I = A.islands;
    const atollRows = I.atolls
      .map(
        (a) =>
          `<tr><td>${esc(a.atoll)}</td><td class="num">${fmt(a.total)}</td><td class="num">${fmt(a.inhabited)}</td></tr>`
      )
      .join("");
    $("#tab-islands").innerHTML = `
      <div class="kpis">
        ${kpi(fmt(I.registryTotal), "islands in registry")}
        ${kpi(fmt(I.total), "with a recorded name")}
        ${kpi(fmt(I.inhabited), "inhabited (residential)")}
        ${kpi(fmt(I.all.uniqueNames), "unique island names")}
        ${kpi(I.all.avgLength, "avg name length")}
      </div>
      <div class="grid2">
        ${card("Island categories", "As classified in the onemap.mv registry", barList(I.categories))}
        ${card("Duplicate island names", "The same name is reused across atolls — occurrences per name", barList(I.duplicateNames.slice(0, 15)))}
      </div>
      <div class="grid2">
        ${card("Island name endings — all islands", "Traditional suffixes (fushi = island/sandbank, dhoo = island, finolhu = sandbank with vegetation, giri = shallow reef…)", suffixTable(I.suffixes.slice(0, 10)))}
        ${card("Island name endings — inhabited only", "Suffix distribution across the inhabited islands", suffixTable(I.inhabitedSuffixes.slice(0, 8)))}
      </div>
      <div class="grid2">
        ${card("Shortest island names", "", extremesTable(I.all.shortest.slice(0, 8)))}
        ${card("Longest island names", "", extremesTable(I.all.longest.slice(0, 8)))}
      </div>
      ${card(
        "Islands per atoll",
        "Registry totals and inhabited counts by administrative atoll",
        `<div style="max-height:420px;overflow:auto"><table class="data"><thead><tr><th>Atoll</th><th class="num">Islands</th><th class="num">Inhabited</th></tr></thead><tbody>${atollRows}</tbody></table></div>`
      )}
      ${card(
        "All inhabited islands",
        `${fmt(I.inhabitedList.length)} residential islands, with Dhivehi names, grouped by atoll`,
        `<div style="max-height:520px;overflow:auto"><table class="data"><thead><tr><th>Atoll</th><th>Island</th><th>ދިވެހި</th><th class="num">Area (ha)</th></tr></thead>
          <tbody>${I.inhabitedList
            .map(
              (i) =>
                `<tr><td>${esc(i.atoll)}</td><td>${esc(i.name)}${i.capital ? " ★" : ""}</td><td class="thaana" dir="rtl">${esc(i.nameDv)}</td><td class="num">${i.areaHa != null ? fmt(i.areaHa) : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>
         <p class="note" style="margin-top:8px">★ = atoll capital. Source: onemap.mv island registry.</p>`
      )}`;
  }

  // ---------- explore (lazy loads full datasets) ----------
  let exploreReady = false;
  async function ensureExplore() {
    if (exploreReady) return;
    exploreReady = true;
    const el = $("#tab-explore");
    el.innerHTML = `<div class="loading">Loading full datasets…</div>`;
    try {
      const [housesMin, roads, islands] = await Promise.all([
        fetch("data/houses.min.json").then((r) => r.json()),
        fetch("data/roads.json").then((r) => r.json()),
        fetch("data/islands.json").then((r) => r.json()),
      ]);
      const KIND = { h: "house", r: "resort unit", c: "unit code", o: "building" };
      const SRC = { mbs: "national register", "mbs-pdf": "census map (Malé City)", osm: "OpenStreetMap" };
      const houses = housesMin.rows.map(([name, ii, kind, src]) => ({
        name,
        island: housesMin.islands[ii][0],
        atoll: housesMin.islands[ii][1],
        kind: KIND[kind] ?? "building",
        src: SRC[src] ?? src,
      }));
      const islandNames = [...new Set([...houses.map((h) => h.island), ...roads.map((r) => r.island)])].sort();
      el.innerHTML = `
        <div class="controls">
          <input type="search" id="q" placeholder="Search any name — e.g. Villa, Hithigasdhoshuge, Majeedhee Magu…">
          <select id="kind">
            <option value="all">Everything</option>
            <option value="houses">House names</option>
            <option value="roads">Road names</option>
            <option value="islands">Island names</option>
          </select>
          <select id="island">
            <option value="">All islands</option>
            ${islandNames.map((n) => `<option>${esc(n)}</option>`).join("")}
          </select>
          <span class="result-count" id="count"></span>
        </div>
        <div class="card" style="padding:0 18px"><div style="max-height:600px;overflow:auto">
          <table class="data"><thead><tr><th>Name</th><th>Type</th><th>Island</th><th>Atoll</th><th>Detail</th></tr></thead>
          <tbody id="rows"></tbody></table>
        </div></div>`;
      const rows = $("#rows");
      const run = () => {
        const q = $("#q").value.trim().toLowerCase();
        const kind = $("#kind").value;
        const isl = $("#island").value;
        const out = [];
        if (kind === "all" || kind === "houses")
          for (const h of houses) {
            if (isl && h.island !== isl) continue;
            if (q && !h.name.toLowerCase().includes(q)) continue;
            out.push({ name: h.name, type: h.kind, island: h.island, atoll: h.atoll, detail: h.src });
            if (out.length >= 500) break;
          }
        if (out.length < 500 && (kind === "all" || kind === "roads"))
          for (const r of roads) {
            if (isl && r.island !== isl) continue;
            if (q && !r.name.toLowerCase().includes(q)) continue;
            out.push({ name: r.name, type: `road (${r.highway})`, island: r.island, atoll: r.atoll, detail: `${r.segments} segment${r.segments > 1 ? "s" : ""}` });
            if (out.length >= 500) break;
          }
        if (out.length < 500 && (kind === "all" || kind === "islands"))
          for (const i of islands) {
            if (isl && i.name !== isl) continue;
            if (q && !i.name.toLowerCase().includes(q)) continue;
            out.push({ name: i.name, type: "island", island: i.name, atoll: i.atoll, detail: i.category });
            if (out.length >= 500) break;
          }
        $("#count").textContent = out.length >= 500 ? "first 500 matches" : `${fmt(out.length)} matches`;
        rows.innerHTML = out
          .map(
            (o) =>
              `<tr><td>${esc(o.name)}</td><td>${esc(o.type)}</td><td>${esc(o.island)}</td><td>${esc(o.atoll)}</td><td>${esc(o.detail)}</td></tr>`
          )
          .join("");
      };
      for (const id of ["q", "kind", "island"]) $(`#${id}`).addEventListener("input", run);
      run();
    } catch (e) {
      el.innerHTML = `<p class="err">Failed to load datasets: ${esc(e.message)}</p>`;
    }
  }

  // ---------- boot ----------
  fetch("data/analysis.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((A) => {
      renderOverview(A);
      renderHousesTab(A);
      renderNameSection($("#tab-roads"), A.roads, { recordsLabel: "distinct named roads", noun: "road names" });
      renderIslands(A);
      $("#generated").textContent = `Analysis generated ${new Date(A.generated).toUTCString()}.`;
    })
    .catch((e) => {
      $("#tab-overview").innerHTML = `<p class="err">Failed to load analysis.json: ${esc(e.message)}</p>`;
    });
})();
