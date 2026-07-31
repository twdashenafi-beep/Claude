# GitHub World Monitor

An integrated, single-file dashboard for monitoring GitHub in real time. Open
`index.html` in any browser — no build step, no dependencies, no server.

![status](https://img.shields.io/badge/build-none%20required-2ea44f)
![data](https://img.shields.io/badge/data-live%20GitHub%20API-0969da)

## What it shows

| Panel | Description |
|-------|-------------|
| **Global stats** | Aggregate stars, top language, and new-repo counts for the trending window, plus last-synced time. |
| **🔥 Trending repositories** | The most-starred repos created in the last 24h / 7d / 30d, ranked, with language, stars, forks, issues, and last-push time. |
| **🌐 Language mix** | Proportional bar + legend of languages across the current trending set. |
| **👤 User / Org monitor** | Look up any user or organization: avatar, bio, repos, followers, following. |
| **📌 Repository watchlist** | Pin any `owner/repo` to track stars, forks, open issues, default branch, and push activity. Saved in your browser via `localStorage`. |

## Data source

All data comes live from the public [GitHub REST API](https://docs.github.com/rest)
(`api.github.com`), fetched client-side. No token is required for public data.

> **Rate limits:** unauthenticated requests are capped at **60/hour** per IP.
> The current remaining budget is shown in the header (`API: 57/60`). If you hit
> the limit, wait for the window to reset or serve the page with a token-backed
> proxy.

## Run it

Just open the file:

```bash
# macOS
open index.html
# Linux
xdg-open index.html
# or serve it
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deploy (optional)

Because it's a single static file, it hosts anywhere — GitHub Pages, Netlify,
S3, or any static host. For GitHub Pages: enable Pages on this repo pointing at
the default branch root, and `index.html` is served automatically.

## Design notes

- **Zero dependencies** — one HTML file, inline CSS + vanilla JS.
- **Light & dark** — follows your system theme automatically.
- **Responsive** — 12-column grid collapses to a single column on mobile.
- **Resilient** — every panel degrades gracefully and surfaces API errors
  (including rate-limit messages) instead of failing silently.
