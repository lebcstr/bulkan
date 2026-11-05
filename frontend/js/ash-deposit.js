import { state } from './state.js';
import { VOLCANO_META, ASH_DEPOSIT_MANIFEST_URL } from './config.js';
import { calculateDistance } from './schools.js';

// Sequential ramp, thinnest to thickest. Spread over however many isopachs a
// model has (Ash3d exports range from 7 levels to 10+), so every level is distinct.
const THICKNESS_RAMP = ['#67e8f9', '#a3e635', '#facc15', '#f59e0b', '#ea580c', '#b91c1c', '#7f1d1d'];

const SCHOOLS_PER_BAND = 100;

const geojsonCache = {};
// Volcano → picked run, or scenario set for scheduled runs.
const selectedRun = {};
// Kept across volcanoes and dates so the same scenario stays up while browsing.
const selectedScenario = { time: null, plumeKm: null };
let manifestPromise = null;
let renderToken = 0;
let ashMap = null;
let ashLayer = null;
let ashLegend = null;
let thicknessLevels = [];

function rampColor(t) {
  const pos = t * (THICKNESS_RAMP.length - 1);
  const i = Math.min(Math.floor(pos), THICKNESS_RAMP.length - 2);
  const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
  const [a, b] = [rgb(THICKNESS_RAMP[i]), rgb(THICKNESS_RAMP[i + 1])];
  return '#' + a.map((c, k) => Math.round(c + (b[k] - c) * (pos - i)).toString(16).padStart(2, '0')).join('');
}

// 0 for the thinnest isopach of the current model, 1 for the thickest.
function levelOf(mm) {
  const i = thicknessLevels.filter(v => v <= mm).length - 1;
  return thicknessLevels.length < 2 ? 1 : Math.max(i, 0) / (thicknessLevels.length - 1);
}

function colorFor(mm) {
  return rampColor(levelOf(mm));
}

// Ash3d splits long contours into several out-of-order line parts; join them
// end-to-start into closed rings so schools can be tested for containment.
function stitchRings(geometry) {
  const parts = geometry.type === 'LineString'
    ? [geometry.coordinates]
    : geometry.coordinates.map(p => p.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const rings = [];
  while (parts.length) {
    const ring = parts.shift();
    let next;
    while (!same(ring[0], ring.at(-1)) && (next = parts.findIndex(p => same(p[0], ring.at(-1)))) !== -1) {
      ring.push(...parts.splice(next, 1)[0].slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > lat) !== (y2 > lat) && lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

// Isopachs sorted thickest first, each with its contour stitched into rings.
function buildIsopachs(geojson) {
  return geojson.features
    .map(f => ({ value: f.properties.VALUE, rings: stitchRings(f.geometry) }))
    .sort((a, b) => b.value - a.value);
}

// Fill each band between an isopach and the next thicker one, cutting the
// thicker rings out as holes so band colours don't stack.
function addBandFills(isopachs, values) {
  const toLatLngs = ring => ring.map(([lng, lat]) => [lat, lng]);
  isopachs.forEach((iso, i) => {
    const holes = i > 0 ? isopachs[i - 1].rings.map(toLatLngs) : [];
    const color = colorFor(iso.value);
    L.polygon([...iso.rings.map(toLatLngs), ...holes], {
      stroke: false, fillColor: color, fillOpacity: 0.28,
    }).bindTooltip(bandLabel(iso.value, values), { sticky: true }).addTo(ashLayer);
  });
}

// Each school gets the thickest isopach that encloses it.
function getSchoolsByThickness(isopachs, vent) {
  const all = isopachs.flatMap(i => i.rings).flat();
  const minLng = Math.min(...all.map(c => c[0])), maxLng = Math.max(...all.map(c => c[0]));
  const minLat = Math.min(...all.map(c => c[1])), maxLat = Math.max(...all.map(c => c[1]));

  return state.allDepEdSchools
    .filter(s => s.lng >= minLng && s.lng <= maxLng && s.lat >= minLat && s.lat <= maxLat)
    .map(s => {
      const hit = isopachs.find(i => i.rings.some(r => pointInRing(s.lng, s.lat, r)));
      return hit && {
        ...s,
        thickness: hit.value,
        distance: calculateDistance(vent[0], vent[1], s.lat, s.lng),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.thickness - a.thickness || a.distance - b.distance);
}

function bandLabel(value, values) {
  const upper = values.filter(v => v > value).at(-1);
  return upper ? `${value}–${upper} mm` : `≥ ${value} mm`;
}

function makeLegend(values) {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'ash-legend');
    div.innerHTML = '<div class="legend-title">Deposit thickness</div>' +
      values.map(v => `
        <div class="legend-item">
          <span class="ash-legend-swatch" style="background:${colorFor(v)}"></span>
          <span>${v} mm</span>
        </div>`).join('') +
      '<div class="legend-item" style="margin-top:0.4rem"><span class="ash-legend-dot"></span><span>📚 School</span></div>';
    return div;
  };
  return legend;
}

function addSchoolMarkers(schools, values) {
  const markers = {};
  // Large scenarios can cover 10k+ schools: draw on canvas and shrink the dots.
  const dense = schools.length > 2000;
  for (const s of schools) {
    const color = colorFor(s.thickness);
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: dense ? 3 : 5, fillColor: color, color: '#e8eaf0', weight: dense ? 0.5 : 1.5, fillOpacity: 0.95,
    });
    marker.bindPopup(() => `
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;min-width:240px;color:#e8eaf0;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <div style="background:var(--surface2);padding:0.75rem;border-bottom:1px solid var(--border);border-radius:6px 6px 0 0;">
          <strong style="color:#ff6b35;font-size:13px;">📚 SCHOOL (${s.type})</strong>
        </div>
        <div style="padding:0.75rem;">
          <div style="margin-bottom:0.5rem;"><strong style="color:#8892a8;font-size:11px;">${s.name}</strong></div>
          <div style="margin-bottom:0.5rem;">
            <strong style="color:#8892a8;">Ash Deposit Thickness:</strong><br/>
            <span style="color:${color};font-weight:700;font-size:13px;">${bandLabel(s.thickness, values)}</span>
          </div>
          <div style="padding-top:0.5rem;border-top:1px solid var(--border);margin-top:0.5rem;font-size:10px;color:#8892a8;">${s.distance.toFixed(1)} km from vent${s.municipality ? ` • ${s.municipality}` : ''}</div>
        </div>
      </div>
    `, { maxWidth: 260, className: 'custom-popup', autoPan: false });
    marker.on('click', () => ashMap.flyTo(marker.getLatLng(), Math.max(ashMap.getZoom(), 13), { duration: 0.8 }));
    marker.addTo(ashLayer);
    markers[s.id] = marker;
  }
  return markers;
}

function renderSchoolBox(schools, values, markers) {
  const el = document.getElementById('ash-deposit-schools');
  if (!el) return;

  const bands = values.map(v => ({ value: v, schools: schools.filter(s => s.thickness === v) }));
  // Chips filter the list to one band; clicking the active chip shows all again.
  const chips = bands.map((b, i) => `
    <button type="button" class="ash-band-chip" data-band="${i}" aria-pressed="false"
      style="border-left-color:${colorFor(b.value)}" ${b.schools.length ? '' : 'disabled'}>
      <span>${bandLabel(b.value, values)}</span><strong>${b.schools.length}</strong>
    </button>`).join('');
  const items = (list, color) => list.map(s => `
    <div class="ash-school-item" data-id="${s.id}" style="border-left-color:${color}">
      <div>${s.name}</div>
      <div class="ash-school-meta">${s.type} • ${s.distance.toFixed(1)} km</div>
    </div>`).join('');
  // Render the first SCHOOLS_PER_BAND per band; the rest on request.
  const list = shown => shown.filter(b => b.schools.length).map(b => `
    <div class="ash-band-title" style="color:${colorFor(b.value)}">${bandLabel(b.value, values)} • ${b.schools.length}</div>
    ${items(b.schools.slice(0, SCHOOLS_PER_BAND), colorFor(b.value))}
    ${b.schools.length > SCHOOLS_PER_BAND
      ? `<button class="ash-show-more" data-band="${bands.indexOf(b)}">Show all ${b.schools.length} schools</button>`
      : ''}`).join('') || '<div class="ash-school-meta" style="text-align:center">No schools</div>';

  el.innerHTML = `
    <div class="ash-school-head">
      <div class="ash-school-title">${schools.length.toLocaleString()} Schools Affected by Ash Deposit within ${values.at(-1)} mm isopach</div>
    </div>
    <div class="ash-band-chips">${chips}</div>
    <div class="ash-school-list">${list(bands)}</div>`;

  const listEl = el.querySelector('.ash-school-list');
  el.querySelector('.ash-band-chips').addEventListener('click', e => {
    const chip = e.target.closest('.ash-band-chip');
    if (!chip || chip.disabled) return;
    const on = chip.getAttribute('aria-pressed') !== 'true';
    el.querySelectorAll('.ash-band-chip').forEach(c => {
      c.classList.toggle('active', on && c === chip);
      c.setAttribute('aria-pressed', String(on && c === chip));
    });
    listEl.innerHTML = list(on ? [bands[chip.dataset.band]] : bands);
    listEl.scrollTop = 0;
  });

  listEl.addEventListener('click', e => {
    const more = e.target.closest('.ash-show-more');
    if (more) {
      const band = bands[more.dataset.band];
      more.outerHTML = items(band.schools.slice(SCHOOLS_PER_BAND), colorFor(band.value));
      return;
    }
    const item = e.target.closest('.ash-school-item');
    const marker = item && markers[item.dataset.id];
    if (!marker) return;
    ashMap.flyTo(marker.getLatLng(), 13, { duration: 0.8 });
    marker.openPopup();
  });
}

function setHeader(text) {
  const el = document.getElementById('ash-deposit-title');
  if (el) el.textContent = `Ashfall Dispersal Simulation · ${text.toUpperCase()}`;
}

function showEmpty(vol, message) {
  document.getElementById('ash-deposit-body')?.classList.add('hidden');
  document.getElementById('ash-deposit-calendar')?.classList.add('hidden');
  closeCalendar();
  const empty = document.getElementById('ash-deposit-empty');
  if (empty) {
    empty.classList.remove('hidden');
    empty.textContent = message;
  }
  setHeader(vol);
}

function loadManifest() {
  manifestPromise ||= fetch(ASH_DEPOSIT_MANIFEST_URL, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch(e => {
      manifestPromise = null;
      throw e;
    });
  return manifestPromise;
}

// YYYY-MM-DD in Philippine time.
const phDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));

// Scheduled runs share a scenario set (one date, time × plume height); each
// older run that doesn't follow the naming convention is a group of its own.
function groupRuns(models) {
  const groups = [];
  for (const m of models) {
    const id = m.scenario?.set || m.id;
    let group = groups.find(g => g.id === id);
    if (!group) {
      group = {
        id,
        date: m.scenario?.date || phDate(m.eruptionStart || m.runDate),
        title: m.scenario ? m.scenario.setTitle : `${m.title} · run ${m.runDate.slice(0, 10)}`,
        models: [],
      };
      groups.push(group);
    }
    group.models.push(m);
  }
  return groups;
}

const hour24 = time => (parseInt(time, 10) % 12) + (/PM/i.test(time) ? 12 : 0);
const uniqueSorted = (values, key) => [...new Set(values)].sort((a, b) => key(a) - key(b));

function scenarioOptions(group) {
  const scenarios = group.models.map(m => m.scenario);
  return {
    times: uniqueSorted(scenarios.map(s => s.time), hour24),
    plumes: uniqueSorted(scenarios.map(s => s.plumeKm), Number),
  };
}

// The selected time and plume height, or the closest this set has: older sets
// may be missing some of the 10 scenarios.
function pickModel(group) {
  if (!group.models[0].scenario) return group.models[0];
  const { times } = scenarioOptions(group);
  const time = times.includes(selectedScenario.time) ? selectedScenario.time : times[0];
  const atTime = group.models
    .filter(m => m.scenario.time === time)
    .sort((a, b) => a.scenario.plumeKm - b.scenario.plumeKm);
  const want = selectedScenario.plumeKm ?? atTime[Math.floor(atTime.length / 2)].scenario.plumeKm;
  const gap = m => Math.abs(m.scenario.plumeKm - want);
  return atTime.reduce((best, m) => (gap(m) < gap(best) ? m : best));
}

// ── Date picker: a month calendar; days without a simulation are struck through.

const formatDay = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});
const shiftMonth = (month, step) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7);
};

let calendar = null; // { vol, groups, group, month } for the panel on screen

function closeCalendar() {
  document.getElementById('ash-calendar-pop')?.classList.add('hidden');
  document.getElementById('ash-calendar-trigger')?.setAttribute('aria-expanded', 'false');
}

function drawCalendar() {
  const pop = document.getElementById('ash-calendar-pop');
  const { groups, group, month } = calendar;
  const available = new Set(groups.map(g => g.date));
  const months = groups.map(g => g.date.slice(0, 7)).sort();
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return available.has(date)
      ? `<button type="button" class="ash-cal-day available ${date === group.date ? 'selected' : ''}" data-date="${date}"
          aria-pressed="${date === group.date}" aria-label="${formatDay(date)}">${i + 1}</button>`
      : `<span class="ash-cal-day unavailable" title="No simulation">${i + 1}</span>`;
  });
  pop.innerHTML = `
    <div class="ash-cal-head">
      <button type="button" class="ash-cal-nav" data-step="-1" aria-label="Previous month" ${month <= months[0] ? 'disabled' : ''}>‹</button>
      <span>${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
      <button type="button" class="ash-cal-nav" data-step="1" aria-label="Next month" ${month >= months.at(-1) ? 'disabled' : ''}>›</button>
    </div>
    <div class="ash-cal-grid">
      ${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<span class="ash-cal-weekday">${d}</span>`).join('')}
      ${'<span></span>'.repeat(lead)}${cells.join('')}
    </div>`;
}

function renderCalendar(vol, groups, group) {
  const wrap = document.getElementById('ash-deposit-calendar');
  if (!wrap) return;
  const pop = document.getElementById('ash-calendar-pop');
  const trigger = document.getElementById('ash-calendar-trigger');
  wrap.classList.remove('hidden');
  calendar = { vol, groups, group, month: group.date.slice(0, 7) };
  trigger.textContent = `📅 ${formatDay(group.date)} ▾`;
  trigger.title = 'Pick a simulation date';
  closeCalendar();

  trigger.onclick = () => {
    const open = pop.classList.toggle('hidden') === false;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      calendar.month = calendar.group.date.slice(0, 7);
      drawCalendar();
    }
  };
  pop.onclick = e => {
    const nav = e.target.closest('.ash-cal-nav');
    if (nav && !nav.disabled) {
      calendar.month = shiftMonth(calendar.month, Number(nav.dataset.step));
      drawCalendar();
      return;
    }
    const day = e.target.closest('.ash-cal-day.available');
    if (!day) return;
    closeCalendar();
    // A day with several runs opens on the first; the Run toggle switches.
    selectedRun[calendar.vol] = calendar.groups.find(g => g.date === day.dataset.date).id;
    updateAshDeposit();
  };
}

// The path is captured at dispatch, so clicks that redraw the calendar still count as inside.
document.addEventListener('click', e => {
  const wrap = document.getElementById('ash-deposit-calendar');
  if (wrap && !e.composedPath().includes(wrap)) closeCalendar();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCalendar();
});

const toggleButtons = (values, current, label, available = () => true, unavailableTitle = '', title = () => '') =>
  values.map(v => `
    <button type="button" data-value="${v}" class="${v === current ? 'active' : ''}" aria-pressed="${v === current}"
      ${title(v) ? `title="${title(v)}"` : ''} ${available(v) ? '' : `disabled title="${unavailableTitle}"`}>${label(v)}</button>`).join('');

// Run toggle for days with several runs, and time / plume height toggles for
// scenario sets. The bar is hidden when there's nothing to switch.
function renderScenarioToggles(vol, groups, group, model) {
  const bar = document.getElementById('ash-deposit-scenario');
  if (!bar) return;
  const timeEl = document.getElementById('ash-scenario-time');
  const plumeEl = document.getElementById('ash-scenario-plume');
  const runEl = document.getElementById('ash-scenario-run');
  const sameDay = groups.filter(g => g.date === group.date);
  bar.classList.toggle('hidden', !model.scenario && sameDay.length < 2);
  runEl.parentElement.classList.toggle('hidden', sameDay.length < 2);
  timeEl.parentElement.classList.toggle('hidden', !model.scenario);
  plumeEl.parentElement.classList.toggle('hidden', !model.scenario);

  const runIds = sameDay.map(g => g.id);
  runEl.innerHTML = toggleButtons(runIds, group.id, id => `Run ${runIds.indexOf(id) + 1}`,
    undefined, '', id => sameDay.find(g => g.id === id).title);
  runEl.onclick = e => {
    const button = e.target.closest('button');
    if (!button) return;
    selectedRun[vol] = button.dataset.value;
    updateAshDeposit();
  };
  if (!model.scenario) return;

  const { times, plumes } = scenarioOptions(group);
  const simulated = new Set(group.models
    .filter(m => m.scenario.time === model.scenario.time)
    .map(m => m.scenario.plumeKm));
  const bind = (el, apply) => {
    el.onclick = e => {
      const button = e.target.closest('button');
      if (!button || button.disabled) return;
      // Pin what's on screen first, so changing one toggle keeps the other.
      selectedScenario.time = model.scenario.time;
      selectedScenario.plumeKm = model.scenario.plumeKm;
      apply(button.dataset.value);
      updateAshDeposit();
    };
  };

  timeEl.innerHTML = toggleButtons(times, model.scenario.time, t => t);
  plumeEl.innerHTML = toggleButtons(plumes, model.scenario.plumeKm, km => `${km} KM`, km => simulated.has(km),
    `Not simulated for ${model.scenario.time}`);
  bind(timeEl, v => { selectedScenario.time = v; });
  bind(plumeEl, v => { selectedScenario.plumeKm = Number(v); });
}

async function loadGeojson(url) {
  if (!geojsonCache[url]) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geojsonCache[url] = await res.json();
  }
  return geojsonCache[url];
}

export function initAshDepositMap() {
  const container = document.getElementById('ash-deposit-map');
  if (!container) return;
  // One shared canvas for bands, contours and schools: draw order is click
  // order, so schools (added after the deposit) sit on top and take the click.
  ashMap = L.map(container, { scrollWheelZoom: false, renderer: L.canvas({ padding: 0.5 }) });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap · Ash3d © USGS',
  }).addTo(ashMap);
  ashLayer = L.layerGroup().addTo(ashMap);
  updateAshDeposit();
}

export async function updateAshDeposit() {
  if (!ashMap) return;
  const vol = state.currentVolcano;
  const token = ++renderToken;

  ashLayer.clearLayers();
  ashLegend?.remove();
  ashLegend = null;

  let model, geojson;
  try {
    const models = (await loadManifest()).models?.[vol] || [];
    if (token !== renderToken) return;
    if (models.length === 0) {
      showEmpty(vol, `No ash deposit model available for ${vol} Volcano.`);
      return;
    }
    const groups = groupRuns(models);
    const group = groups.find(g => g.id === selectedRun[vol]) || groups[0];
    model = pickModel(group);
    renderCalendar(vol, groups, group);
    renderScenarioToggles(vol, groups, group, model);
    geojson = await loadGeojson(model.url);
  } catch (e) {
    console.error(`[ash-deposit] failed to load ${vol} ash deposit model:`, e);
    if (token === renderToken) showEmpty(vol, `Ash deposit data for ${vol} Volcano is unavailable.`);
    return;
  }
  // The user may have switched volcano or run while the file was loading.
  if (token !== renderToken) return;
  ashLayer.clearLayers();
  ashLegend?.remove();

  document.getElementById('ash-deposit-empty')?.classList.add('hidden');
  document.getElementById('ash-deposit-body')?.classList.remove('hidden');
  setHeader(model.title);
  ashMap.invalidateSize();

  const values = [...new Set(geojson.features.map(f => f.properties.VALUE))].sort((a, b) => b - a);
  thicknessLevels = [...values].reverse();
  const isopachs = buildIsopachs(geojson);
  addBandFills(isopachs, values);

  const contours = L.geoJSON(geojson, {
    style: f => ({
      color: colorFor(f.properties.VALUE),
      weight: 1.5 + levelOf(f.properties.VALUE) * 2.4,
      opacity: 0.95,
    }),
    onEachFeature: (f, l) => {
      l.bindTooltip(`${f.properties.VALUE} ${f.properties.UNITS}`, { sticky: true });
    },
  }).addTo(ashLayer);

  const vent = VOLCANO_META[vol].coords;
  const schools = getSchoolsByThickness(isopachs, vent);
  const markers = addSchoolMarkers(schools, values);

  L.circleMarker(vent, {
    radius: 8, fillColor: '#ff6b35', color: '#fff', weight: 2, fillOpacity: 1,
  }).bindPopup(`<strong>${vol} Volcano</strong><br>Vent`).addTo(ashLayer);

  ashMap.fitBounds(contours.getBounds().extend(vent), { padding: [20, 20] });

  ashLegend = makeLegend(values).addTo(ashMap);
  renderSchoolBox(schools, values, markers);
}
