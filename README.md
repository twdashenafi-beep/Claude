# World Monitor — Horn of Africa & Strategic Commodities

A self-contained, single-file **situational-awareness dashboard** in the
"World Monitor" style: it tracks strategic commodities (**gold, oil & gas,
copper**) alongside **Horn of Africa geopolitics**, and shows how regional
events transmit into those markets. Open `index.html` in any browser — no
build, no dependencies, no server, no external network calls.

![build](https://img.shields.io/badge/build-none%20required-2ea44f)
![data](https://img.shields.io/badge/data-editable%20layer-d6a626)

## Panels

| Panel | What it shows |
|-------|---------------|
| **📈 Strategic commodities** | Gold, Brent crude, natural gas, copper — price, 1-day change, sparkline trend, and the key regional driver for each. |
| **🗺️ Country risk board** | Ethiopia, Sudan, Somalia, Eritrea, Djibouti, South Sudan — a risk rating (Low → Severe) and the defining issue for each state. |
| **🧭 Regional risk index** | A single composite gauge with a plain-language read on what's driving it. |
| **⚡ Active flashpoints** | Sudan war, Red Sea / Bab-el-Mandeb shipping, Ethiopia–Somaliland port MoU, GERD / Nile — severity-ranked with tags. |
| **🔗 Commodity ↔ region linkage** | The transmission channels: how Horn events move gold, oil, gas and copper. |
| **🛰️ Intel feed** | A category-tagged headline stream (illustrative). |

## ⚠️ About the data

This ships with a **curated, dated data layer**, not a live feed:

- **Market values are illustrative** — a plausible snapshot for demonstration,
  clearly banner-labeled in the UI. Do **not** treat them as real quotes.
- **Geopolitical context is real** in the sense that it reflects well-established,
  ongoing regional dynamics (as of the `asOf` date) — but it is a briefing
  template, so verify against primary sources before any operational use.

All content lives in one place: the `DATA` object near the top of the `<script>`
in `index.html`. Edit it to update the snapshot, or swap each block for a live
`fetch()`.

## Going live

The dashboard has a built-in live-data layer. Open the **⚙ settings** panel in
the header:

| Feed | Source | Setup |
|------|--------|-------|
| **Intel feed** | [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) — global news index | **Keyless.** On by default. Queries the Horn states + Red Sea / Bab-el-Mandeb, auto-categorises each headline (security / energy / diplomacy / economy), and links to the source. |
| **Commodities** | [API Ninjas](https://api-ninjas.com/api/commodityprice) — one key covers gold, oil, gas & copper | Paste a **free API key** in settings. Prices then update live; the 1-day change and sparkline build from a rolling history kept in `localStorage` (so the trend fills in over successive refreshes). |

Set an **auto-refresh** interval (5–60 min) in the same panel. The header shows
**Live** / **Demo** status and the last-updated time; each commodity tile carries
a `live` / `demo` badge.

**Two things to know:**

1. **Serve the page** — live `fetch()` calls work from `localhost` or GitHub
   Pages, but are **blocked inside the sandboxed Artifact preview** (its CSP
   forbids external requests). Everything degrades gracefully to the labelled
   snapshot when a call can't be made.
2. **Keys stay local** — the API key and preferences live only in your browser's
   `localStorage`; the only network calls are made directly from your browser to
   the provider you configured.

### If a provider blocks browser (CORS) requests

Some data providers don't send CORS headers, so the browser rejects the
response. The fix is a **thin proxy**: a tiny serverless function that holds the
key, calls the upstream server-side, and returns JSON. Point the relevant
`fetch()` URL (`NINJA` / `GDELT` in the script) at your proxy and the front end
stays a single static file. The other blocks (`flashpoints`, `countries`,
`riskIndex`) are analyst-curated in the `DATA` object — edit them directly, or
generate them from a conflict-event dataset (e.g. ACLED-style feeds).

## Run it

```bash
open index.html            # macOS
xdg-open index.html        # Linux
python3 -m http.server 8000  # then visit http://localhost:8000
```

## Deploy

It's one static file — host it anywhere (GitHub Pages, Netlify, S3). For GitHub
Pages, enable Pages on this repo pointing at the branch root; `index.html` is
served automatically.

## Design notes

- **Zero dependencies** — one HTML file, inline CSS + vanilla JS, no external requests.
- **Light & dark** — follows the system theme.
- **Responsive** — 12-column grid collapses to a single column on mobile.
- **Region scope** — Ethiopia · Eritrea · Djibouti · Somalia · Sudan · South Sudan.
