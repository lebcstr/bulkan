#!/usr/bin/env node
// Pulls USGS Ash3d deposit-thickness shapefiles from one private Google Drive
// folder per volcano and converts them to GeoJSON under frontend/data/ash/,
// plus a manifest (frontend/data/ash_deposits.json) the dashboard reads.
//
// Each folder may hold, per model run: a .zip from Ash3d, a subfolder with the
// depothik.* files, or the depothik.* files directly.
//
// Auth: GDRIVE_SA_KEY = the service account's JSON key (folders shared with it).
// Local testing: `node build-ash-deposits.mjs --local <dir>` reads
// <dir>/<Volcano>/ instead of Drive.
import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getAccessToken } from './google-auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'frontend', 'data');
const OUT_DIR = join(DATA_DIR, 'ash');
const MANIFEST = join(DATA_DIR, 'ash_deposits.json');

const DRIVE_FOLDERS = {
  Kanlaon: '1S_QKDfhzlo2fQkKH_gh7GMRJ_rL0j5IB',
  Mayon: '1GLK0Cz4tbzTE2sSLnRyrDMhUpTciFG80',
  Taal: '1pXxMZ_yP0mPqmAypCwRTey-O69YmWyad',
};

const DEPOSIT_VAR = 'Final Deposit Thickness';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

// ── Google Drive ────────────────────────────────────────────────────────────

function driveSource(token) {
  const get = async (url) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive ${url.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
    return res;
  };
  return {
    async list(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)',
          pageSize: '1000',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await (await get(`${DRIVE_API}?${params}`)).json();
        files.push(...page.files.map(f => ({ ...f, isFolder: f.mimeType === FOLDER_MIME })));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return files;
    },
    async download(file) {
      return Buffer.from(await (await get(`${DRIVE_API}/${file.id}?alt=media&supportsAllDrives=true`)).arrayBuffer());
    },
  };
}

// Same interface as driveSource, backed by a local directory tree.
function localSource() {
  return {
    async list(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      return Promise.all(entries.filter(e => !e.name.startsWith('.')).map(async e => {
        const s = await stat(join(dir, e.name));
        return {
          id: join(dir, e.name),
          name: e.name,
          isFolder: e.isDirectory(),
          createdTime: s.birthtime.toISOString(),
          modifiedTime: s.mtime.toISOString(),
        };
      }));
    },
    download: file => readFile(file.id),
  };
}

// ── Shapefile parsing ───────────────────────────────────────────────────────

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = { data: method === 8 ? inflateRawSync(data) : data, mtime: dosTime(buf, p + 12) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Zip entries store an MS-DOS local timestamp; treated as UTC.
function dosTime(buf, at) {
  const t = buf.readUInt16LE(at);
  const d = buf.readUInt16LE(at + 2);
  return new Date(Date.UTC(1980 + (d >> 9), ((d >> 5) & 15) - 1, d & 31, t >> 11, (t >> 5) & 63, (t & 31) * 2)).toISOString();
}

function readDbf(buf) {
  const nrec = buf.readUInt32LE(4);
  const hlen = buf.readUInt16LE(8);
  const rlen = buf.readUInt16LE(10);
  const fields = [];
  for (let p = 32; buf[p] !== 0x0d; p += 32) {
    fields.push({
      name: buf.toString('latin1', p, p + 11).replace(/\0.*$/, ''),
      type: String.fromCharCode(buf[p + 11]),
      len: buf[p + 16],
    });
  }
  const rows = [];
  for (let i = 0; i < nrec; i++) {
    let off = hlen + i * rlen + 1;
    const row = {};
    for (const f of fields) {
      const raw = buf.toString('latin1', off, off + f.len).trim();
      off += f.len;
      row[f.name] = 'NF'.includes(f.type) && raw !== '' ? Number(raw) : raw;
    }
    rows.push(row);
  }
  return rows;
}

function readShp(buf) {
  const geoms = [];
  for (let p = 100; p < buf.length;) {
    const len = buf.readInt32BE(p + 4) * 2;
    const body = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len;
    const type = body.readInt32LE(0);
    if (type === 0) { geoms.push(null); continue; }
    if (![3, 13, 23].includes(type)) throw new Error(`shape type ${type} is not a PolyLine`);
    const nparts = body.readInt32LE(36);
    const npts = body.readInt32LE(40);
    const starts = Array.from({ length: nparts }, (_, i) => body.readInt32LE(44 + 4 * i)).concat(npts);
    const p0 = 44 + 4 * nparts;
    const pts = Array.from({ length: npts }, (_, i) => [
      +body.readDoubleLE(p0 + 16 * i).toFixed(6),
      +body.readDoubleLE(p0 + 16 * i + 8).toFixed(6),
    ]);
    const lines = starts.slice(0, -1).map((s, i) => pts.slice(s, starts[i + 1]));
    geoms.push(lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines });
  }
  return geoms;
}

// ── Collecting shapefiles from a volcano folder ─────────────────────────────

const ext = name => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const stem = name => name.slice(0, name.lastIndexOf('.')).toLowerCase();

// Pairs each .shp with its .dbf. Re-uploading depothik.* into the same folder
// gives duplicate names, so pick the .dbf uploaded closest in time.
function pairShapefiles(files) {
  const dbfs = files.filter(f => ext(f.name) === 'dbf');
  return files.filter(f => ext(f.name) === 'shp').map(shp => {
    const t = Date.parse(shp.createdTime);
    const dbf = dbfs
      .filter(d => stem(d.name) === stem(shp.name))
      .sort((a, b) => Math.abs(Date.parse(a.createdTime) - t) - Math.abs(Date.parse(b.createdTime) - t))[0];
    return { shp, dbf };
  });
}

async function collect(source, folderId, path) {
  const files = await source.list(folderId);
  const found = [];
  for (const { shp, dbf } of pairShapefiles(files)) {
    if (!dbf) { console.warn(`[skip] ${path}/${shp.name}: no matching .dbf`); continue; }
    found.push({
      origin: `${path}/${shp.name}`,
      shp: await source.download(shp),
      dbf: await source.download(dbf),
      fileTime: shp.modifiedTime || shp.createdTime,
    });
  }
  for (const zip of files.filter(f => ext(f.name) === 'zip')) {
    const entries = unzip(await source.download(zip));
    const names = Object.keys(entries).filter(n => !n.startsWith('__MACOSX'));
    for (const name of names.filter(n => ext(n) === 'shp')) {
      const dbf = names.find(n => ext(n) === 'dbf' && n.slice(0, -4).toLowerCase() === name.slice(0, -4).toLowerCase());
      if (!dbf) { console.warn(`[skip] ${path}/${zip.name}:${name}: no matching .dbf`); continue; }
      found.push({
        origin: `${path}/${zip.name}:${name}`,
        shp: entries[name].data,
        dbf: entries[dbf].data,
        fileTime: entries[name].mtime,
      });
    }
  }
  for (const sub of files.filter(f => f.isFolder)) {
    found.push(...await collect(source, sub.id, `${path}/${sub.name}`));
  }
  return found;
}

// ── Conversion ──────────────────────────────────────────────────────────────

const compactTime = iso => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/00Z$/, 'Z');

const formatDate = iso => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila',
}).format(new Date(iso));

// Brings both Ash3d shapefile layouts to the current one's attributes:
// - current: VOLC, VAR, VALUE, UNITS, INDEX, E_STIME, RUN DATE, ... per contour
// - older export (dp_mm.*): only name ("<Volcano>_Deposit_mm"), value, index;
//   no eruption or run times, so the run date falls back to the file timestamp.
function normalizeRows(rows, origin, fileTime) {
  const first = rows[0];
  if (!first) {
    console.warn(`[skip] ${origin}: .dbf has no records`);
    return null;
  }
  if ('VAR' in first) {
    if (first.VAR !== DEPOSIT_VAR) {
      console.warn(`[skip] ${origin}: VAR is "${first.VAR}", not "${DEPOSIT_VAR}"`);
      return null;
    }
    return rows;
  }
  const legacy = String(first.name ?? '').trim().match(/^(.+?)_Deposit_mm$/i);
  if (legacy && 'value' in first) {
    const ranked = [...new Set(rows.map(r => r.value))].sort((a, b) => a - b);
    return rows.map(r => ({
      VOLC: legacy[1].replace(/_/g, ' '),
      VAR: DEPOSIT_VAR,
      VALUE: r.value,
      UNITS: 'mm',
      INDEX: ranked.indexOf(r.value),
      'RUN DATE': fileTime,
    }));
  }
  console.warn(`[skip] ${origin}: not an Ash3d deposit thickness shapefile (columns: ${Object.keys(first).join(', ')})`);
  return null;
}

function convert(volcano, { origin, shp, dbf, fileTime }) {
  const rows = normalizeRows(readDbf(dbf), origin, fileTime);
  if (!rows) return null;
  const first = rows[0];
  if (String(first.VOLC).trim().toLowerCase() !== volcano.toLowerCase()) {
    console.warn(`[skip] ${origin}: model is for "${first.VOLC}" but is in the ${volcano} folder`);
    return null;
  }
  const geoms = readShp(shp);
  if (geoms.length !== rows.length) throw new Error(`${origin}: ${geoms.length} shapes but ${rows.length} records`);

  const eruptionStart = first.E_STIME || null;
  const runDate = first['RUN DATE'];
  const id = `${volcano.toLowerCase()}_${eruptionStart ? `${compactTime(eruptionStart)}_` : ''}run${compactTime(runDate)}`;
  return {
    entry: {
      id,
      title: eruptionStart
        ? `${volcano} ${formatDate(eruptionStart)} Eruption`
        : `${volcano} Ash3d Model · ${formatDate(runDate)}`,
      eruptionStart,
      runDate,
      url: `./data/ash/${id}.geojson`,
    },
    geojson: {
      type: 'FeatureCollection',
      features: geoms.map((geometry, i) => ({ type: 'Feature', properties: rows[i], geometry })),
    },
  };
}

async function main() {
  const localIdx = process.argv.indexOf('--local');
  const localDir = localIdx !== -1 ? process.argv[localIdx + 1] : null;
  const source = localDir
    ? localSource()
    : driveSource(await getAccessToken('https://www.googleapis.com/auth/drive.readonly'));

  // Convert everything in memory first so a Drive failure leaves the
  // previously published models untouched.
  const models = {};
  const outputs = [];
  for (const [volcano, folderId] of Object.entries(DRIVE_FOLDERS)) {
    const shapefiles = await collect(source, localDir ? join(localDir, volcano) : folderId, volcano);
    const list = (models[volcano] = []);
    for (const shapefile of shapefiles) {
      const result = convert(volcano, shapefile);
      if (!result) continue;
      if (list.some(m => m.id === result.entry.id)) {
        console.warn(`[dupe] ${shapefile.origin} is the same run as an earlier file; keeping the first`);
        continue;
      }
      list.push(result.entry);
      outputs.push(result);
      console.log(`[${volcano}] ${result.entry.title} (${result.geojson.features.length} isopachs) ← ${shapefile.origin}`);
    }
    // Newest eruption first (run date when the eruption time is unknown), then newest run.
    const when = m => m.eruptionStart || m.runDate;
    list.sort((a, b) => when(b).localeCompare(when(a)) || b.runDate.localeCompare(a.runDate));
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const { entry, geojson } of outputs) {
    await writeFile(join(OUT_DIR, `${entry.id}.geojson`), JSON.stringify(geojson));
  }
  await writeFile(MANIFEST, JSON.stringify({ models }, null, 2) + '\n');
  console.log(`wrote ${outputs.length} model(s) → ${MANIFEST}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
