import { render, selectVol } from './dashboard.js';
import { initMap, selectZone } from './map.js';
import { initAshDepositMap, updateAshDeposit } from './ash-deposit.js';
import { loadDepEdSchools } from './schools.js';
import { loadVolcanoData, initializeMockData } from './data.js';
import { selectTimeRange, selectParameter, navigatePeriod } from './charts.js';
import { toggleLaharChat, sendLaharMessage, resetLaharChat } from './lahar-chat.js';

// Inline onclick handlers in index.html call these as globals.
Object.assign(window, {
  selectVol,
  selectZone,
  selectTimeRange,
  selectParameter,
  navigatePeriod,
  toggleLaharChat,
  sendLaharMessage,
  resetLaharChat,
});

function setStatus(text) {
  const el = document.getElementById('lastUpdate');
  if (el) el.textContent = text;
}

// Minimize / expand buttons in the Risk Zones and Ashfall Simulation headers.
function initPanelToggles() {
  document.querySelectorAll('[data-panel-toggle]').forEach(btn => {
    const label = btn.getAttribute('aria-label').replace(/^Minimize /, '');
    btn.addEventListener('click', () => {
      const collapsed = btn.closest('.panel').classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Minimize'} ${label}`);
    });
  });
}

async function main() {
  initPanelToggles();
  initMap();
  initAshDepositMap();

  initializeMockData();
  render();
  setStatus('Loading… (Sample Data)');

  selectZone(null, 6);

  try {
    await loadDepEdSchools();
    updateAshDeposit();
  } catch (e) {
    console.error('[main] failed to load schools:', e);
  }

  const loaded = await loadVolcanoData();
  render();

  const synced = loaded.map(x => x.syncedAt).filter(Boolean).sort().slice(-1)[0];
  setStatus(synced
    ? `Last sync: ${new Date(synced).toLocaleString()}`
    : `Last sync: — (Sample Data)`);

  document.getElementById('lahar-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendLaharMessage();
  });
}

document.addEventListener('DOMContentLoaded', main);
