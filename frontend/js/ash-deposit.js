import { state } from './state.js';
import { VOLCANO_META, ASH_DEPOSIT_MANIFEST_URL } from './config.js';
import { calculateDistance } from './schools.js';

// Sequential ramp, thinnest to thickest. Spread over however many isopachs a
// model has (Ash3d exports range from 7 levels to 10+), so every level is distinct.
const THICKNESS_RAMP = ['#67e8f9', '#a3e635', '#facc15', '#f59e0b', '#ea580c', '#b91c1c', '#7f1d1d'];

const SCHOOLS_PER_BAND = 100;

const geojsonCache = {};
const selectedRun = {};
let schoolRenderer = null;
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
      renderer: schoolRenderer,
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
    `, { maxWidth: 260, className: 'custom-popup' });
    marker.addTo(ashLayer);
    markers[s.id] = marker;
  }
  return markers;
}

function renderSchoolBox(schools, values, markers) {
  const el = document.getElementById('ash-deposit-schools');
  if (!el) return;

  const bands = values.map(v => ({ value: v, schools: schools.filter(s => s.thickness === v) }));
  const chips = bands.map(b => `
    <div class="ash-band-chip" style="border-left-color:${colorFor(b.value)}">
      <span>${bandLabel(b.value, values)}</span><strong>${b.schools.length}</strong>
    </div>`).join('');
  const items = (list, color) => list.map(s => `
    <div class="ash-school-item" data-id="${s.id}" style="border-left-color:${color}">
      <div>📚 ${s.name}</div>
      <div class="ash-school-meta">${s.type} • ${s.distance.toFixed(1)} km</div>
    </div>`).join('');
  // Render the first SCHOOLS_PER_BAND per band; the rest on request.
  const list = bands.filter(b => b.schools.length).map((b, i) => `
    <div class="ash-band-title" style="color:${colorFor(b.value)}">${bandLabel(b.value, values)} • ${b.schools.length}</div>
    ${items(b.schools.slice(0, SCHOOLS_PER_BAND), colorFor(b.value))}
    ${b.schools.length > SCHOOLS_PER_BAND
      ? `<button class="ash-show-more" data-band="${i}">Show all ${b.schools.length} schools</button>`
      : ''}`).join('');
  const shownBands = bands.filter(b => b.schools.length);

  el.innerHTML = `
    <div class="ash-school-head">
      <div class="ash-school-title">📚 Schools by Ash Deposit</div>
      <div class="ash-school-sub">${schools.length} schools within ${values.at(-1)} mm isopach</div>
    </div>
    <div class="ash-band-chips">${chips}</div>
    <div class="ash-school-list">${list || '<div class="ash-school-meta" style="text-align:center">No schools</div>'}</div>`;

  el.querySelector('.ash-school-list').addEventListener('click', e => {
    const more = e.target.closest('.ash-show-more');
    if (more) {
      const band = shownBands[more.dataset.band];
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

// Older Ash3d exports carry no eruption parameters, so only show what exists.
function renderInfo(props, model, values) {
  const el = document.getElementById('ash-deposit-info');
  if (!el) return;
  const utc = iso => new Date(iso).toUTCString().replace(':00 GMT', ' UTC');
  const rows = [
    ['Eruption start', props.E_STIME && utc(props.E_STIME)],
    ['Plume height', props.E_PLMH && `${parseFloat(props.E_PLMH)} km`],
    ['Duration', props.E_DUR && `${parseFloat(props.E_DUR)} h`],
    ['Erupted volume', props.E_VOL && `${parseFloat(props.E_VOL)} km³`],
    ['Deposit time', props.TIME && utc(props.TIME)],
    ['Isopachs', `${values.length} (${values.at(-1)}–${values[0]} mm)`],
    ['Model run', props.ORG
      ? `${props.ORG} Ash3d · ${props['RUN CLASS']}`
      : `Ash3d · ${new Date(model.runDate).toISOString().slice(0, 10)}`],
  ].filter(([, v]) => v);
  el.innerHTML = rows.map(([k, v]) => `
    <div class="ash-info-row">
      <div class="ash-info-label">${k}</div>
      <div class="ash-info-value">${v}</div>
    </div>`).join('') +
    (props.E_STIME ? '' : '<div class="ash-info-note">Eruption parameters are not included in this shapefile (older Ash3d export).</div>') +
    `<a class="ash-info-link" href="${props.URL || 'https://vsc-ash.wr.usgs.gov/ash3d-gui'}" target="_blank" rel="noopener">USGS Ash3d ↗</a>`;
}

function setHeader(text) {
  const el = document.getElementById('ash-deposit-title');
  if (el) el.textContent = `🌋 ASH DEPOSIT MODEL · ${text.toUpperCase()}`;
}

function showEmpty(vol, message) {
  document.getElementById('ash-deposit-body')?.classList.add('hidden');
  document.getElementById('ash-deposit-run')?.classList.add('hidden');
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

// Run picker in the panel header; only shown when a volcano has several runs.
function renderRunPicker(vol, models, model) {
  const select = document.getElementById('ash-deposit-run');
  if (!select) return;
  select.classList.toggle('hidden', models.length < 2);
  select.innerHTML = models.map(m => `
    <option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>
      ${m.title} · run ${m.runDate.slice(0, 10)}
    </option>`).join('');
  select.onchange = () => {
    selectedRun[vol] = select.value;
    updateAshDeposit();
  };
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
  ashMap = L.map(container, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap · Ash3d © USGS',
  }).addTo(ashMap);
  ashLayer = L.layerGroup().addTo(ashMap);
  schoolRenderer = L.canvas({ padding: 0.5 });
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
    model = models.find(m => m.id === selectedRun[vol]) || models[0];
    renderRunPicker(vol, models, model);
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
  renderInfo(geojson.features[0].properties, model, values);
}
