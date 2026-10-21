#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'frontend', 'data');

const COLUMN_INDICES_DEFAULT = {
  DATE: 0, AlertLevel: 1, VEQ: 2, VolcanicTremors: 3,
  Rockfall: 4, PDCEvents: 5, SO2Flux: 6, PlumeHeight: 7, STALTA: null,
};

const COLUMN_INDICES_KANLAON = {
  DATE: 2, AlertLevel: 1, VEQ: 3, VolcanicTremors: null,
  Rockfall: null, PDCEvents: null, SO2Flux: 7, PlumeHeight: 8, STALTA: 13, Eruption: 10
};

const VOLCANO_SOURCES = {
  kanlaon: {
    sheetId: '1WJImbfbuHfn7YqitoCFrHEIm1eSLvXtOvTTx49C8cw8',
    tab: 'Kanlaon-Dup-2',
    columns: COLUMN_INDICES_KANLAON,
    // Eruption days are marked with a red background on the description cell.
    eruptionMarker: { dateCol: 'C', markerCol: 'K' },
  },
  mayon: {
    sheetId: '1nQOK3UgNOcYA1ywNl6OHR5vNNcK92Ff4',
    tab: 'Mayon',
    columns: COLUMN_INDICES_DEFAULT,
  },
  taal: {
    sheetId: '1nQOK3UgNOcYA1ywNl6OHR5vNNcK92Ff4',
    tab: 'Taal',
    columns: COLUMN_INDICES_DEFAULT,
  },
};

async function fetchSheet(sheetId, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}&headers=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${tab}`);
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Malformed gviz response for ${tab}`);
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status === 'error') {
    throw new Error(payload.errors?.[0]?.message || 'gviz error');
  }
  return payload.table;
}

// gviz returns values only, so cell colours come from the xlsx export.
async function fetchXlsx(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for xlsx export`);
  return unzip(Buffer.from(await res.arrayBuffer()));
}

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('xlsx export is not a zip');
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
    files[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function isRed(rgb) {
  if (!rgb || rgb.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(rgb.slice(-6).slice(i, i + 2), 16));
  return r >= 0xc0 && r - g >= 0x40 && Math.abs(g - b) <= 0x30;
}

function serialToDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Returns the set of dates (YYYY-MM-DD) whose marker cell has a red background.
function findEruptionDates(files, tab, { dateCol, markerCol }) {
  const workbook = files['xl/workbook.xml'];
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map(m => m[0]).find(t => attr(t, 'name') === tab);
  if (!sheetTag) throw new Error(`Tab ${tab} not found in xlsx export`);
  const rid = attr(sheetTag, 'r:id');
  const relTag = files['xl/_rels/workbook.xml.rels'].match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`))[0];
  const sheetXml = files['xl/' + attr(relTag, 'Target').replace(/^\/?xl\//, '')];

  const styles = files['xl/styles.xml'];
  const fillRed = [...styles.match(/<fills\b.*?<\/fills>/s)[0].matchAll(/<fill>.*?<\/fill>|<fill\/>/gs)]
    .map(m => isRed(attr(m[0].match(/<fgColor\b[^>]*>/)?.[0] ?? '', 'rgb')));
  const xfRed = [...styles.match(/<cellXfs\b.*?<\/cellXfs>/s)[0].matchAll(/<xf\b[^>]*>/g)]
    .map(m => fillRed[Number(attr(m[0], 'fillId') ?? 0)] ?? false);

  const dates = new Set();
  for (const [, rowXml] of sheetXml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)) {
    let date = null, red = false;
    for (const [, tag, body = ''] of rowXml.matchAll(/(<c\b[^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const col = attr(tag, 'r').replace(/\d+/, '');
      if (col === dateCol && !attr(tag, 't')) {
        const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
        if (v) date = serialToDate(Number(v));
      } else if (col === markerCol) {
        red = xfRed[Number(attr(tag, 's') ?? 0)];
      }
    }
    if (date && red) dates.add(date);
  }
  return dates;
}

function parseRows(table) {
  if (!table?.rows) return [];
  return table.rows.map(r => (r.c || []).map(c => c ? (c.v ?? c.f ?? '') : ''));
}

function normalizeDate(v) {
  if (typeof v === 'string' && v.startsWith('Date(')) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) {
      const y = m[1];
      const mo = String(parseInt(m[2], 10) + 1).padStart(2, '0');
      const d = String(parseInt(m[3], 10)).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }
  return v;
}

function pick(row, idx) {
  if (idx === null || idx === undefined) return '';
  return row[idx] ?? '';
}

function rowsToObjects(rows, cols) {
  return rows.map(row => ({
    DATE: normalizeDate(pick(row, cols.DATE)),
    AlertLevel: pick(row, cols.AlertLevel),
    VEQ: pick(row, cols.VEQ),
    VolcanicTremors: pick(row, cols.VolcanicTremors),
    Rockfall: pick(row, cols.Rockfall),
    PDCEvents: pick(row, cols.PDCEvents),
    SO2Flux: pick(row, cols.SO2Flux),
    PlumeHeight: pick(row, cols.PlumeHeight),
    STALTA: pick(row, cols.STALTA),
  }));
}

async function syncOne(name, source) {
  const table = await fetchSheet(source.sheetId, source.tab);
  const rows = parseRows(table);
  const records = rowsToObjects(rows, source.columns)
    .filter(r => r.DATE !== '' && r.DATE !== null);
  if (source.eruptionMarker) {
    const files = await fetchXlsx(source.sheetId);
    const eruptions = findEruptionDates(files, source.tab, source.eruptionMarker);
    for (const r of records) r.eruption = eruptions.has(r.DATE) ? 1 : 0;
    console.log(`[${name}] ${eruptions.size} eruption days`);
  }
  const outPath = join(OUT_DIR, `${name}.json`);
  await writeFile(outPath, JSON.stringify({
    volcano: name,
    syncedAt: new Date().toISOString(),
    records,
  }, null, 2));
  console.log(`[${name}] wrote ${records.length} rows → ${outPath}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = await Promise.allSettled(
    Object.entries(VOLCANO_SOURCES).map(([name, src]) => syncOne(name, src))
  );
  const failed = results.filter(r => r.status === 'rejected');
  for (const r of failed) console.error('FAIL:', r.reason?.message || r.reason);
  if (failed.length === results.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
