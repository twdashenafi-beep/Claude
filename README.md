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

## Wiring live data (optional)

The `DATA` object is structured so each block maps cleanly to an API:

| Block | Suggested source |
|-------|------------------|
| `commodities[].price / .spark` | A commodities/markets API (e.g. metals & energy price feeds). Most require an API key, so proxy the call through a small backend to keep the key server-side and avoid browser CORS/rate-limit issues. |
| `feed[]` | A news API filtered to the region (query the Horn states + commodities), or an RSS aggregator. |
| `flashpoints[] / countries[]` | Curated by an analyst, or generated from a conflict-event dataset (e.g. ACLED-style feeds). |
| `riskIndex` | Computed from the above (weighted country risk + active flashpoint severity). |

Because unauthenticated, browser-side calls to most of these are rate-limited or
CORS-blocked, the recommended pattern is a **thin proxy**: a tiny serverless
function holds the keys, calls the upstreams, and returns JSON shaped like the
`DATA` blocks. The front end stays a single static file.

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
