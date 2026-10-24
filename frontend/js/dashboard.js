import { state } from './state.js';
import { VOLCANO_META } from './config.js';
import { STALTA_THRESHOLD } from './charts.js';
import { updateTrendChart, updateRadarChart, updateNavigationButtons } from './charts.js';
import { updateMapMarkers, selectZone } from './map.js';
import { updateLiveFeeds } from './kanlaon-snapshot.js';
import { updateAshDeposit } from './ash-deposit.js';

export function render() {
  renderTabs();
  renderParams();
  updateMapMarkers();
  updateRadarChart();
  updateTrendChart();
  updateNavigationButtons();
}

function renderTabs() {
  const html = Object.keys(VOLCANO_META).map(vol => {
    const data = state.dashboardData[vol] || [];
    let level = 1;
    let date = 'N/A';
    let stalta = NaN;
    if (data.length > 0) {
      const latest = data[data.length - 1];
      if (latest.AlertLevel) level = Math.round(parseFloat(latest.AlertLevel)) || 1;
      date = (latest.DATE || 'N/A').toString().substring(0, 10);
      stalta = parseFloat(latest.STALTA);
    }
    const staltaExceeded = stalta > STALTA_THRESHOLD;
    const levelClass = level === 1 ? 'level-1' : level === 2 ? 'level-2' : 'level-3';
    const isActive = vol === state.currentVolcano ? 'active' : '';
    const staltaClass = staltaExceeded ? 'stalta-alert' : '';
    const staltaWarning = staltaExceeded
      ? `<div class="stalta-warning">STA/LTA &gt; ${STALTA_THRESHOLD.toFixed(1)}: possible eruption within 7–14 days</div>`
      : '';
    return `
      <div class="vtab ${isActive} ${staltaClass}" onclick="selectVol('${vol}')" style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem">
        <div style="flex:1">
          <h3 style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
            <span style="font-size:20px">🌋</span>
            ${vol} Volcano
          </h3>
          <p>${VOLCANO_META[vol].elevation} • ${VOLCANO_META[vol].type}</p>
          <p style="color:var(--text3);margin-top:0.3rem">As of: ${date}</p>
          ${staltaWarning}
        </div>
        <div class="alert-badge ${levelClass}">${level}</div>
      </div>`;
  }).join('');
  document.getElementById('volcano-tabs').innerHTML = html;
}

function renderParams() {
  const data = state.dashboardData[state.currentVolcano] || [];
  const container = document.getElementById('param-list');

  if (data.length === 0) {
    container.innerHTML = '<div class="loading">No data</div>';
    return;
  }

  const latest = data[data.length - 1];
  const date = (latest.DATE || 'N/A').toString().substring(0, 10);
  document.getElementById('param-latest-update').textContent = `Latest: ${date}`;

  const params = [
    { key: 'VEQ', label: 'VEQ', unit: 'events/day' },
    { key: 'VolcanicTremors', label: 'Volcanic Tremors', unit: 'events/day' },
    { key: 'Rockfall', label: 'Rockfall', unit: 'events/day' },
    { key: 'PDCEvents', label: 'PDC Events', unit: 'events/day' },
    { key: 'SO2Flux', label: 'SO₂ Flux', unit: 'tons/day' },
    { key: 'PlumeHeight', label: 'Plume Height', unit: 'm' },
    { key: 'STALTA', label: 'STA/LTA', unit: 'ratio' },
  ];

  let html = '';
  let found = 0;

  for (const p of params) {
    const val = latest[p.key];
    if (val !== null && val !== undefined && val !== '' && val !== 'None' && val !== 'none' && val !== 0 && val !== '0') {
      let display = val;
      if (typeof val === 'string') {
        const num = parseFloat(val);
        if (!isNaN(num) && num !== 0) display = Math.round(num * 100) / 100;
      } else if (typeof val === 'number') {
        display = Math.round(val * 100) / 100;
      }
      html += `
        <div class="param-item">
          <div>
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase">${p.label}</div>
            <div style="font-size:9px;color:var(--text3);margin-top:0.2rem">${p.unit}</div>
          </div>
          <div class="param-value">${display}</div>
        </div>`;
      found++;
    }
  }
  container.innerHTML = found === 0 ? '<div class="error">⚠️ No active parameters</div>' : html;
}

export function selectVol(vol) {
  state.currentVolcano = vol;
  render();
  if (state.map) {
    const cfg = VOLCANO_META[vol];
    state.map.setView(cfg.coords, cfg.zoomLevel);
    selectZone(null, 6);
  }
  updateLiveFeeds();
  updateAshDeposit();
}
