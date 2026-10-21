#!/usr/bin/env node
// Checks the latest synced record of each volcano for an STA/LTA ratio above
// the threshold. When one is found, writes an email body and exposes
// `alert`, `subject` and `body_file` as GitHub Actions step outputs.
//
// Run after `sync` and before the snapshots are committed: a volcano is only
// reported when its latest record differs from the one in the last committed
// snapshot (HEAD), so the same reading is not emailed again every day.
// Set FORCE_ALERT=true to skip that check.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..');
const DATA_DIR = join(REPO_DIR, 'frontend', 'data');

// Keep in sync with STALTA_THRESHOLD in frontend/js/charts.js.
const STALTA_THRESHOLD = 2.0;
const VOLCANOES = ['kanlaon', 'mayon', 'taal'];
const DASHBOARD_URL = process.env.DASHBOARD_URL || '';
const FORCE = process.env.FORCE_ALERT === 'true';

// Same rule as the dashboard: the latest record is the last row.
function latestReading(snapshot) {
  const records = snapshot?.records || [];
  if (records.length === 0) return null;
  const latest = records[records.length - 1];
  return { date: String(latest.DATE).substring(0, 10), stalta: parseFloat(latest.STALTA), alertLevel: latest.AlertLevel };
}

function previousSnapshot(name) {
  try {
    const text = execFileSync('git', ['show', `HEAD:frontend/data/${name}.json`], {
      cwd: REPO_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildBody(alerts) {
  const rows = alerts.map(a => `
        <tr>
          <td style="padding:6px 12px;border:1px solid #ddd">${capitalize(a.volcano)}</td>
          <td style="padding:6px 12px;border:1px solid #ddd">${a.date}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;color:#c0392b;font-weight:bold">${a.stalta.toFixed(2)}</td>
          <td style="padding:6px 12px;border:1px solid #ddd">${a.alertLevel === '' ? 'N/A' : a.alertLevel}</td>
        </tr>`).join('');
  const link = DASHBOARD_URL ? `<p><a href="${DASHBOARD_URL}">Open the Bulkan dashboard</a></p>` : '';
  return `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;color:#222">
    <h2 style="color:#c0392b">STA/LTA threshold exceeded</h2>
    <p>The latest synced data shows an STA/LTA ratio above the ${STALTA_THRESHOLD.toFixed(1)} threshold,
       which may indicate a possible eruption within 7–14 days.</p>
    <table style="border-collapse:collapse">
      <thead>
        <tr>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Volcano</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Date</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">STA/LTA</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Alert level</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
    ${link}
    <p style="color:#888;font-size:12px">Sent automatically by the Bulkan daily data sync.</p>
  </body>
</html>
`;
}

async function main() {
  const alerts = [];
  for (const name of VOLCANOES) {
    let current;
    try {
      current = JSON.parse(await readFile(join(DATA_DIR, `${name}.json`), 'utf8'));
    } catch (err) {
      console.error(`[${name}] could not read snapshot: ${err.message}`);
      continue;
    }
    const latest = latestReading(current);
    if (!latest || !(latest.stalta > STALTA_THRESHOLD)) {
      console.log(`[${name}] latest STA/LTA ${latest?.stalta ?? 'N/A'} — below threshold`);
      continue;
    }
    const prev = latestReading(previousSnapshot(name));
    if (!FORCE && prev && prev.date === latest.date && prev.stalta > STALTA_THRESHOLD) {
      console.log(`[${name}] STA/LTA ${latest.stalta} on ${latest.date} already reported — skipping`);
      continue;
    }
    console.log(`[${name}] STA/LTA ${latest.stalta} on ${latest.date} exceeds ${STALTA_THRESHOLD}`);
    alerts.push({ volcano: name, ...latest });
  }

  if (alerts.length === 0) {
    await setOutput('alert', 'false');
    return;
  }

  const bodyFile = join(process.env.RUNNER_TEMP || tmpdir(), 'stalta-alert.html');
  await writeFile(bodyFile, buildBody(alerts));
  const names = alerts.map(a => capitalize(a.volcano)).join(', ');
  await setOutput('alert', 'true');
  await setOutput('subject', `[Bulkan] STA/LTA above ${STALTA_THRESHOLD.toFixed(1)}: ${names}`);
  await setOutput('body_file', bodyFile);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
