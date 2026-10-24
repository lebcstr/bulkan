import { state } from './state.js';
import { VOLCANO_META, ASH_DEPOSIT_MANIFEST_URL } from './config.js';
import { calculateDistance } from './schools.js';

// Sequential ramp: thin deposits pale, thick deposits dark.
const THICKNESS_COLORS = [
  [10, '#7f1d1d'],
  [3, '#b91c1c'],
  [1, '#ea580c'],
  [0.3, '#f59e0b'],
  [0.1, '#facc15'],
  [0.03, '#a3e635'],
  [0.01, '#67e8f9'],
];

const geojsonCache = {};
const selectedRun = {};
let manifestPromise = null;
let renderToken = 0;
let ashMap = null;
let ashLayer = null;
let ashLegend = null;

function colorFor(mm) {
  return (THICKNESS_COLORS.find(([v]) => mm >= v) || THICKNESS_COLORS.at(-1))[1];
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
  for (const s of schools) {
    const color = colorFor(s.thickness);
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: 5, fillColor: color, color: '#e8eaf0', weight: 1.5, fillOpacity: 0.95,
    });
    marker.bindPopup(`
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
  const list = bands.filter(b => b.schools.length).map(b => `
    <div class="ash-band-title" style="color:${colorFor(b.value)}">${bandLabel(b.value, values)} • ${b.schools.length}</div>
    ${b.schools.map(s => `
      <div class="ash-school-item" data-id="${s.id}" style="border-left-color:${colorFor(b.value)}">
        <div>📚 ${s.name}</div>
        <div class="ash-school-meta">${s.type} • ${s.distance.toFixed(1)} km</div>
      </div>`).join('')}`).join('');

  el.innerHTML = `
    <div class="ash-school-head">
      <div class="ash-school-title">📚 Schools by Ash Deposit</div>
      <div class="ash-school-sub">${schools.length} schools within ${values.at(-1)} mm isopach</div>
    </div>
    <div class="ash-band-chips">${chips}</div>
    <div class="ash-school-list">${list || '<div class="ash-school-meta" style="text-align:center">No schools</div>'}</div>`;

  el.querySelectorAll('.ash-school-item').forEach(item => {
    item.addEventListener('click', () => {
      const marker = markers[item.dataset.id];
      if (!marker) return;
      ashMap.flyTo(marker.getLatLng(), 13, { duration: 0.8 });
      marker.openPopup();
    });
  });
}

function renderInfo(props) {
  const el = document.getElementById('ash-deposit-info');
  if (!el) return;
  const rows = [
    ['Eruption start', new Date(props.E_STIME).toUTCString().replace(':00 GMT', ' UTC')],
    ['Plume height', `${parseFloat(props.E_PLMH)} km`],
    ['Duration', `${parseFloat(props.E_DUR)} h`],
    ['Erupted volume', `${parseFloat(props.E_VOL)} km³`],
    ['Deposit time', new Date(props.TIME).toUTCString().replace(':00 GMT', ' UTC')],
    ['Model run', `${props.ORG} Ash3d · ${props['RUN CLASS']}`],
  ];
  el.innerHTML = rows.map(([k, v]) => `
    <div class="ash-info-row">
      <div class="ash-info-label">${k}</div>
      <div class="ash-info-value">${v}</div>
    </div>`).join('') +
    `<a class="ash-info-link" href="${props.URL}" target="_blank" rel="noopener">USGS Ash3d ↗</a>`;
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

  const values = geojson.features.map(f => f.properties.VALUE).sort((a, b) => b - a);
  const isopachs = buildIsopachs(geojson);
  addBandFills(isopachs, values);

  const contours = L.geoJSON(geojson, {
    style: f => ({
      color: colorFor(f.properties.VALUE),
      weight: 1.5 + f.properties.INDEX * 0.4,
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
  renderInfo(geojson.features[0].properties);
}
