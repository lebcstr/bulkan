#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getAccessToken } from './google-auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'frontend', 'data');

const COLUMN_INDICES_TAAL = {
  DATE: 1, AlertLevel: 0, VEQ: 5, VolcanicTremors: 6,
  Rockfall: null, PDCEvents: 5, SO2Flux: 2, PlumeHeight: 9, STALTA: null, Eruption: 11
};

const COLUMN_INDICES_MAYON = {
  DATE: 1, AlertLevel: 0, VEQ: 2, VolcanicTremors: 3,
  Rockfall: 4, PDCEvents: 5, SO2Flux: 7, PlumeHeight: 8, STALTA: null, Eruption: 10
};

const COLUMN_INDICES_KANLAON = {
  DATE: 2, AlertLevel: 1, VEQ: 3, VolcanicTremors: null,
  Rockfall: null, PDCEvents: null, SO2Flux: 7, PlumeHeight: 8, STALTA: 13, Eruption: 10
};

const VOLCANO_SOURCES = {
  kanlaon: {
    sheetId: '1OHHgo043us1oTq_5gg8r8aKo2h3EbQQVjHnoVpV4WYM',
    tab: 'Sheet1',
    columns: COLUMN_INDICES_KANLAON,
  },
  mayon: {
    sheetId: '19_dxIPl5COPnlACF0at0ZqdFss5sGH3HWBaDFn2_2Cs',
    tab: 'Sheet1',
    columns: COLUMN_INDICES_MAYON,
  },
  taal: {
    sheetId: '170KpOGupG9ijfSqptHpFW2DpEr-h0iIigiMq6neeuYQ',
    tab: 'SinceJan13',
    columns: COLUMN_INDICES_TAAL,
  },
};

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// Returns the tab's rows below the header row. Values come unformatted, with
// dates as serial day numbers (see normalizeDate).
async function fetchSheet(token, sheetId, tab) {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const params = new URLSearchParams({
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const res = await fetch(`${SHEETS_API}/${sheetId}/values/${range}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets ${tab}: HTTP ${res.status} ${await res.text()}`);
  const { values = [] } = await res.json();
  return values.slice(1);
}

// Eruption days are rows whose Eruption cell mentions the word "eruption".
function isEruption(cell) {
  return /eruption/i.test(String(cell ?? ''));
}

// Sheets date cells are days since 1899-12-30; text dates pass through.
function normalizeDate(v) {
  if (typeof v === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
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

async function syncOne(token, name, source) {
  const rows = await fetchSheet(token, source.sheetId, source.tab);
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
  const token = await getAccessToken(SHEETS_SCOPE);
  const results = await Promise.allSettled(
    Object.entries(VOLCANO_SOURCES).map(([name, src]) => syncOne(token, name, src))
  );
  const failed = results.filter(r => r.status === 'rejected');
  for (const r of failed) console.error('FAIL:', r.reason?.message || r.reason);
  if (failed.length === results.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
