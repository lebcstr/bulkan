# Bulkan — Volcano Impact Risk Model

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
│   │   ├── ash-deposit.js       Ash3d deposit map + schools per thickness band
│   │   ├── dashboard.js         top-level render (tabs, params)
│   │   ├── kanlaon-snapshot.js  Kanlaon camera feed + news panel
│   │   ├── lahar-chat.js        floating chat widget
│   │   ├── affected-locations.js  static alert-school / evac-center data
│   │   └── main.js              entry point — wires DOMContentLoaded
│   └── data/
│       ├── deped_schools.json           (43,502 schools)
│       ├── kanlaon.json / mayon.json / taal.json   (produced by scripts)
│       ├── ash_deposits.json + ash/*.geojson       (produced by scripts)
├── scripts/
│   ├── sync-sheets.mjs    Node 20 script: Google Sheets gviz → JSON
│   ├── build-ash-deposits.mjs  Ash3d shapefiles (Google Drive) → GeoJSON
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

## Ash deposit models (USGS Ash3d)

The **Ash Deposit Model** panel shows Ash3d final deposit thickness isopachs and the DepEd schools inside each thickness band.

### Publishing a new model

Upload the Ash3d deposit shapefile to the volcano's Google Drive folder, as the downloaded `.zip`, a subfolder with the `depothik.*` files, or the `depothik.*` files directly:

| Volcano | Drive folder ID |
|---|---|
| Kanlaon | `1S_QKDfhzlo2fQkKH_gh7GMRJ_rL0j5IB` |
| Mayon   | `1GLK0Cz4tbzTE2sSLnRyrDMhUpTciFG80` |
| Taal    | `1pXxMZ_yP0mPqmAypCwRTey-O69YmWyad` |

The daily **Sync Sheets Data** workflow (09:00 PH time) picks it up and redeploys. To publish immediately, run that workflow from the Actions tab.

- Volcano, eruption time and run date are read from the shapefile itself; file names don't matter.
- A model whose volcano doesn't match its folder is skipped (see the workflow log).
- The newest eruption is shown by default; older runs appear in the panel's dropdown.
- Deleting a file from Drive removes that model on the next run. If Drive can't be read, the last published models stay up.

### Access

The folders are private and shared (Viewer) with a Google Cloud service account. Its JSON key is stored as the repository secret `GDRIVE_SA_KEY`. To rotate it: create a new key on the service account, replace the secret, then delete the old key.

### Run locally

```bash
cd scripts
GDRIVE_SA_KEY="$(cat path/to/key.json)" npm run ash
# or, without Drive, from a local folder laid out as <dir>/Kanlaon, <dir>/Mayon, <dir>/Taal:
node build-ash-deposits.mjs --local <dir>
# writes frontend/data/ash/*.geojson and frontend/data/ash_deposits.json
```

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
