#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
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
    tab: 'Sheet1',
    columns: COLUMN_INDICES_KANLAON,
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

// Eruption days are rows whose Eruption cell mentions the word "eruption".
function isEruption(cell) {
  return /eruption/i.test(String(cell ?? ''));
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
  if (source.columns.Eruption != null) {
    const eruptions = new Set(rows
      .filter(row => isEruption(pick(row, source.columns.Eruption)))
      .map(row => normalizeDate(pick(row, source.columns.DATE))));
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
