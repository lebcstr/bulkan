#!/usr/bin/env node
// Sanity-checks the volcano snapshots before they are published. Exits non-zero
// so the sync stops and the last committed snapshots stay in place.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOLCANOES = ['kanlaon', 'mayon', 'taal'];
const MAX_RECORD_DROP = 0.1; // a sheet losing >10% of its rows is treated as a bad pull

function committedRecords(path) {
  const json = execFileSync('git', ['-C', ROOT, 'show', `HEAD:${path}`], {
    maxBuffer: 1e8,
    encoding: 'utf8',
  });
  return JSON.parse(json).records;
}

async function check(name) {
  const path = `frontend/data/${name}.json`;
  const { records } = JSON.parse(await readFile(join(ROOT, path), 'utf8'));
  if (!Array.isArray(records) || records.length === 0) return [`${name}: no records`];

  const problems = [];
  const previous = committedRecords(path).length;
  if (records.length < previous * (1 - MAX_RECORD_DROP)) {
    problems.push(`${name}: record count fell from ${previous} to ${records.length}`);
  }
  const badDates = records.filter(r => Number.isNaN(Date.parse(r.DATE)));
  if (badDates.length) {
    const sample = badDates.slice(0, 3).map(r => JSON.stringify(r.DATE)).join(', ');
    problems.push(`${name}: ${badDates.length} unparseable DATE value(s), e.g. ${sample}`);
  }
  return problems;
}

const problems = [];
for (const name of VOLCANOES) {
  try {
    problems.push(...await check(name));
  } catch (err) {
    problems.push(`${name}: ${err.message}`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`INVALID: ${p}`);
  process.exit(1);
}
console.log(`Validated ${VOLCANOES.join(', ')}.`);
