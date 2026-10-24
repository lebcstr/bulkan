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
import { createSign } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

async function getAccessToken() {
  const raw = process.env.GDRIVE_SA_KEY;
  if (!raw) throw new Error('GDRIVE_SA_KEY is not set');
  const key = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

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
          fields: 'nextPageToken, files(id, name, mimeType, createdTime)',
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
      return Promise.all(entries.filter(e => !e.name.startsWith('.')).map(async e => ({
        id: join(dir, e.name),
        name: e.name,
        isFolder: e.isDirectory(),
        createdTime: (await stat(join(dir, e.name))).birthtime.toISOString(),
      })));
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
    files[name] = method === 8 ? inflateRawSync(data) : data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
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
    found.push({ origin: `${path}/${shp.name}`, shp: await source.download(shp), dbf: await source.download(dbf) });
  }
  for (const zip of files.filter(f => ext(f.name) === 'zip')) {
    const entries = unzip(await source.download(zip));
    const names = Object.keys(entries).filter(n => !n.startsWith('__MACOSX'));
    for (const name of names.filter(n => ext(n) === 'shp')) {
      const dbf = names.find(n => ext(n) === 'dbf' && n.slice(0, -4).toLowerCase() === name.slice(0, -4).toLowerCase());
      if (!dbf) { console.warn(`[skip] ${path}/${zip.name}:${name}: no matching .dbf`); continue; }
      found.push({ origin: `${path}/${zip.name}:${name}`, shp: entries[name], dbf: entries[dbf] });
    }
  }
  for (const sub of files.filter(f => f.isFolder)) {
    found.push(...await collect(source, sub.id, `${path}/${sub.name}`));
  }
  return found;
}

// ── Conversion ──────────────────────────────────────────────────────────────

const compactTime = iso => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/00Z$/, 'Z');

function titleFor(volcano, eruptionStart) {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila',
  }).format(new Date(eruptionStart));
  return `${volcano} ${date} Eruption`;
}

function convert(volcano, { origin, shp, dbf }) {
  const rows = readDbf(dbf);
  const first = rows[0];
  if (!first || first.VAR !== DEPOSIT_VAR) {
    console.warn(`[skip] ${origin}: VAR is "${first?.VAR}", not "${DEPOSIT_VAR}"`);
    return null;
  }
  if (String(first.VOLC).trim().toLowerCase() !== volcano.toLowerCase()) {
    console.warn(`[skip] ${origin}: model is for "${first.VOLC}" but is in the ${volcano} folder`);
    return null;
  }
  const geoms = readShp(shp);
  if (geoms.length !== rows.length) throw new Error(`${origin}: ${geoms.length} shapes but ${rows.length} records`);

  const id = `${volcano.toLowerCase()}_${compactTime(first.E_STIME)}_run${compactTime(first['RUN DATE'])}`;
  return {
    entry: {
      id,
      title: titleFor(volcano, first.E_STIME),
      eruptionStart: first.E_STIME,
      runDate: first['RUN DATE'],
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
  const source = localDir ? localSource() : driveSource(await getAccessToken());

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
    // Newest eruption first, then newest model run.
    list.sort((a, b) => b.eruptionStart.localeCompare(a.eruptionStart) || b.runDate.localeCompare(a.runDate));
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
