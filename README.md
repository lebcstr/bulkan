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
│   ├── sync-sheets.mjs    Node 20 script: Google Sheets API → JSON
│   ├── build-ash-deposits.mjs  Ash3d shapefiles (Google Drive) → GeoJSON
│   ├── google-auth.mjs    service-account token for both scripts
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

Both scripts need the service account's JSON key in `GDRIVE_SA_KEY` (see [Google access](#google-access)). Run them from `scripts/`, where `package.json` lives.

```bash
cd scripts
GDRIVE_SA_KEY="$(cat path/to/key.json)" npm run sync
# writes frontend/data/{kanlaon,mayon,taal}.json
```

PowerShell:

```powershell
cd scripts
$env:GDRIVE_SA_KEY = Get-Content path\to\key.json -Raw
npm run sync
```

This overwrites the committed snapshots, so check `git diff` before committing. Keep the key file outside the repo.

## Deploy to GitHub Pages

1. Push to a GitHub repo (`main` branch).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The `deploy-pages.yml` workflow publishes `frontend/` on every push to `main` and after a successful data sync.
4. The `sync-data.yml` workflow runs daily at 01:00 UTC (09:00 PH time, ~30 min after the source sheets refresh) and commits refreshed snapshots. You can trigger it manually from the Actions tab. It needs the `GDRIVE_SA_KEY` repository secret.

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
- Older Ash3d exports (`dp_mm.*`, columns `name`/`value`/`index` only) also work. They carry no eruption parameters, so the run date comes from the file timestamp and the model is titled "<Volcano> Ash3d Model · <date>".
- A model whose volcano doesn't match its folder is skipped (see the workflow log).
- The newest eruption is shown by default; older runs appear in the panel's dropdown.
- Deleting a file from Drive removes that model on the next run. If Drive can't be read, the last published models stay up.

The folders are private and read with the service account (see [Google access](#google-access)).

### Run locally

```bash
cd scripts
GDRIVE_SA_KEY="$(cat path/to/key.json)" npm run ash
# or, without Drive, from a local folder laid out as <dir>/Kanlaon, <dir>/Mayon, <dir>/Taal:
node build-ash-deposits.mjs --local <dir>
# writes frontend/data/ash/*.geojson and frontend/data/ash_deposits.json
```

## Data sources

Volcano records come from the automated monitoring Google Sheets, read with the Sheets API v4 as the service account. The sheets stay private; they only need to be shared (Viewer) with the service account.

| Volcano | Sheet ID | Tab |
|---|---|---|
| Kanlaon | `1OHHgo043us1oTq_5gg8r8aKo2h3EbQQVjHnoVpV4WYM` | `Sheet1` |
| Mayon   | `19_dxIPl5COPnlACF0at0ZqdFss5sGH3HWBaDFn2_2Cs` | `Sheet1` |
| Taal    | `170KpOGupG9ijfSqptHpFW2DpEr-h0iIigiMq6neeuYQ` | `SinceJan13` |

Columns are mapped **by position**, so inserting or reordering a column in a sheet shifts the data. Row 1 is the header and is skipped.

| Field | Kanlaon | Mayon | Taal |
|---|---|---|---|
| AlertLevel | B | A | A |
| DATE | C | B | B |
| VEQ | D | C | F |
| VolcanicTremors | – | D | G |
| Rockfall | – | E | – |
| PDCEvents | – | F | F |
| SO2Flux | H | H | C |
| PlumeHeight | I | I | J |
| STALTA | N | – | – |
| Eruption | K | K | L |

- Dates may be real date cells or text; date cells are written as `YYYY-MM-DD`.
- A day is flagged `eruption: 1` when its Eruption cell contains the word "eruption".
- Fields with no column (–) are written as empty strings.

To change a source or a column, edit `VOLCANO_SOURCES` / `COLUMN_INDICES_*` in `scripts/sync-sheets.mjs`.

## Google access

Both scripts authenticate as one Google Cloud service account. Its JSON key is the repository secret `GDRIVE_SA_KEY`, and the same value is used locally.

- **Sharing:** share each sheet and each Ash3d Drive folder with the service account's `client_email` (Viewer).
- **APIs:** the **Google Sheets API** and **Google Drive API** must both be enabled in the service account's project.
- **Native Sheets only:** an uploaded `.xlsx` can't be read by the Sheets API; convert it with *File → Save as Google Sheets*.
- **Cost:** both APIs are free; usage (a few requests a day) is far below quota.
- **Rotating the key:** create a new key on the service account, replace the secret, then delete the old key.

Common errors:

| Error | Cause |
|---|---|
| `GDRIVE_SA_KEY is not set` | env variable / secret missing |
| `403 … has not been used in project` | Sheets or Drive API not enabled |
| `403 The caller does not have permission` | file not shared with the service account |
| `400 This operation is not supported for this document` | file is an `.xlsx`, not a Google Sheet |

## Known gaps

- **Kanlaon** has no columns mapped for `VolcanicTremors`, `Rockfall`, or `PDCEvents`, so those stay empty. If the sheet gains them, update `COLUMN_INDICES_KANLAON`.
- **Two legacy HTML files** (`Bulkan Latest.html`, `Volcano Embed HTML.html`) still live at the repo root. They are the pre-split monoliths — keep them for reference or move to an `archive/` folder.
