# Local Copy of Bulkan — Volcano Impact Risk Model (UP-NOAH)

https://lebcstr.github.io/bulkan/

Static dashboard that shows PHIVOLCS-style monitoring data (VEQ, Rockfall, PDC, SO₂, Plume), risk-zone maps with DepEd schools and evacuation centers, and a small chat helper.

## Layout

```
.
├── frontend/              ← published to GitHub Pages
│   ├── index.html         shell (CDN libs + CSS + module entry)
│   ├── css/styles.css
│   ├── js/
│   │   ├── config.js            static constants (sources, zones, thresholds, feeds, news)
│   │   ├── state.js             shared mutable runtime state
│   │   ├── data.js              loads snapshot JSON from ./data/*.json
│   │   ├── schools.js           DepEd schools loader + distance queries
│   │   ├── charts.js            trend chart + radar chart (Chart.js)
│   │   ├── map.js               Leaflet map + risk zones + markers
│   │   ├── dashboard.js         top-level render (tabs, params)
│   │   ├── kanlaon-snapshot.js  Kanlaon camera feed + news panel
│   │   ├── lahar-chat.js        floating chat widget
│   │   ├── affected-locations.js  static alert-school / evac-center data
│   │   └── main.js              entry point — wires DOMContentLoaded
│   └── data/
│       ├── deped_schools.json           (43,502 schools)
│       └── kanlaon.json / mayon.json / taal.json   (produced by scripts)
├── scripts/
│   ├── sync-sheets.mjs    Node 20 script: Google Sheets gviz → JSON
│   └── package.json
└── .github/workflows/
    ├── sync-data.yml      cron: daily sheet pull → commits data/*.json
    └── deploy-pages.yml   push: deploys frontend/ to GH Pages
```

## Run locally

Serve `frontend/` over HTTP (ES modules need HTTP, not `file://`):

```bash
cd frontend
python3 -m http.server 8082
# → http://localhost:8082/
```

## Refresh data manually

```bash
cd scripts
npm run sync
# writes frontend/data/{kanlaon,mayon,taal}.json
```

## Deploy to GitHub Pages

1. Push to a GitHub repo (`main` branch).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The `deploy-pages.yml` workflow publishes `frontend/` on every push to `main` and after a successful data sync.
4. The `sync-data.yml` workflow runs daily at 20:00 UTC (≈ 04:00 PH time) and commits refreshed snapshots. You can trigger it manually from the Actions tab.

## Data sources

Volcano records are pulled from Google Sheets via the public `gviz/tq` endpoint. Each sheet must be shared as **"Anyone with the link → Viewer"**.

| Volcano | Sheet ID | Tab | Column map |
|---|---|---|---|
| Kanlaon | `18TGh3YbQEKVoX9Htk9MtOoB6RnuPwiisvbXVMpLM1WA` | `Sheet1` | `KANLAON` (AlertLevel=A, DATE=B, Earthquakes=C, SO₂=G, Plume=H) |
| Mayon   | `1OHHgo043us1oTq_5gg8r8aKo2h3EbQQVjHnoVpV4WYM` | `Mayon` | `DEFAULT` |
| Taal    | `1OHHgo043us1oTq_5gg8r8aKo2h3EbQQVjHnoVpV4WYM` | `Taal`  | `DEFAULT` |

To change a source, edit `VOLCANO_SOURCES` in `scripts/sync-sheets.mjs`.

## Known gaps

- **Mayon/Taal sheet is private.** `scripts/sync-sheets.mjs` currently returns `HTTP 401` for both. Either share that sheet as "Anyone with the link → Viewer", or point them at a different source. Kanlaon syncs cleanly (~1850 rows).
- **Kanlaon columns D/E/F** in the source sheet are unlabeled, so `VolcanicTremors`, `Rockfall`, and `PDCEvents` are left empty for Kanlaon. If any of those three correspond to a real column, update `COLUMN_INDICES_KANLAON` in `scripts/sync-sheets.mjs` **and** `frontend/js` (if ever re-added).
- **Two legacy HTML files** (`Bulkan Latest.html`, `Volcano Embed HTML.html`) still live at the repo root. They are the pre-split monoliths — keep them for reference or move to an `archive/` folder.
