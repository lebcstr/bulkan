import { state } from './state.js';
import { VOLCANO_META, ZONES } from './config.js';
import { AFFECTED_LOCATIONS } from './affected-locations.js';
import { getDepEdSchoolsInRadius } from './schools.js';

export function initMap() {
  state.map = L.map('map').setView([13, 122], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(state.map);
  state.markersLayer = L.layerGroup().addTo(state.map);
}

export function updateMapMarkers() {
  if (!state.markersLayer) return;
  state.markersLayer.clearLayers();
  for (const [vol, cfg] of Object.entries(VOLCANO_META)) {
    const marker = L.circleMarker(cfg.coords, {
      radius: vol === state.currentVolcano ? 8 : 6,
      fillColor: vol === state.currentVolcano ? '#ff6b35' : '#ff4444',
      color: vol === state.currentVolcano ? '#ff8c2a' : '#ff6b35',
      weight: vol === state.currentVolcano ? 3 : 2,
      opacity: 1,
      fillOpacity: 0.8,
      title: vol,
    });
    marker.bindPopup(`<strong>${vol}</strong><br>Elevation: ${cfg.elevation}<br>Type: ${cfg.type}`);
    marker.addTo(state.markersLayer);
  }
}

export function selectZone(event, radius) {
  state.currentRadius = radius;
  document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
  if (event?.target) event.target.classList.add('active');
  else document.querySelectorAll('.zone-btn')[radius === 6 ? 0 : radius === 8 ? 1 : 2]?.classList.add('active');

  const zone = ZONES[radius];
  document.getElementById('population-value').textContent = zone.pop.toLocaleString();
  document.getElementById('zone-area').textContent = zone.area + ' km²';
  document.getElementById('current-radius').textContent = radius + ' km';
  document.getElementById('km-safe-zone').textContent = zone.kmToSafeZone + ' km';

  if (state.zoneCircle) state.map.removeLayer(state.zoneCircle);
  const coords = VOLCANO_META[state.currentVolcano].coords;
  state.zoneCircle = L.circle(coords, {
    radius: radius * 1000,
    color: zone.color,
    fillColor: zone.color,
    fillOpacity: 0.3,
    weight: 2,
  }).addTo(state.map);

  displayAffectedLocations(radius);

  const zoomLevel = radius === 6 ? 12 : 11;
  state.map.flyTo(coords, zoomLevel, { duration: 1 });
}

const STATUS_COLORS = { Critical: '#ff4444', Priority: '#ff8c2a', Moderate: '#ffc62a', Low: '#44cc66' };

function displayAffectedLocations(radius) {
  if (state.schoolMarkers) state.schoolMarkers.clearLayers();
  else state.schoolMarkers = L.layerGroup().addTo(state.map);
  if (state.centerMarkers) state.centerMarkers.clearLayers();
  else state.centerMarkers = L.layerGroup().addTo(state.map);

  const locationData = AFFECTED_LOCATIONS[state.currentVolcano]?.[radius];
  if (!locationData) return;

  const coords = VOLCANO_META[state.currentVolcano].coords;
  const depEd = getDepEdSchoolsInRadius(coords[0], coords[1], radius);
  const allSchools = [...locationData.schools, ...depEd.elementary, ...depEd.highSchool];

  for (const school of allSchools) {
    const color = STATUS_COLORS[school.status] || '#8892a8';
    const icon = L.divIcon({
      html: `<div style="width:16px;height:16px;background-color:${color};border:2.5px solid #e8eaf0;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">📚</div>`,
      iconSize: [20, 20],
      className: 'school-marker',
    });
    const marker = L.marker([school.lat, school.lng], { icon });
    const typeLabel = school.isDepEd ? ` (${school.type})` : '';
    marker.bindPopup(`
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;min-width:240px;color:#e8eaf0;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <div style="background:var(--surface2);padding:0.75rem;border-bottom:1px solid var(--border);border-radius:6px 6px 0 0;">
          <strong style="color:#ff6b35;font-size:13px;">📚 SCHOOL${typeLabel}</strong>
        </div>
        <div style="padding:0.75rem;">
          <div style="margin-bottom:0.5rem;"><strong style="color:#8892a8;font-size:11px;">${school.name}</strong></div>
          <div style="margin-bottom:0.5rem;">
            <strong style="color:#8892a8;">Evacuation Status:</strong><br/>
            <span style="color:${color};font-weight:700;font-size:13px;">${school.status}</span>
          </div>
          <div style="padding-top:0.5rem;border-top:1px solid var(--border);margin-top:0.5rem;font-size:10px;color:#8892a8;">⚠️ Ensure student evacuation</div>
        </div>
      </div>
    `, { maxWidth: 260, className: 'custom-popup' });
    state.schoolMarkers.addLayer(marker);
  }

  for (const center of locationData.centers) {
    const icon = L.divIcon({
      html: `<div style="width:20px;height:20px;position:relative;display:flex;align-items:center;justify-content:center;background:#44cc66;clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);border:2.5px solid #e8eaf0;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-size:11px;font-weight:700;">🏛️</div>`,
      iconSize: [24, 24],
      className: 'evacuation-marker',
    });
    const marker = L.marker([center.lat, center.lng], { icon });
    marker.bindPopup(`
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;min-width:260px;color:#e8eaf0;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <div style="background:var(--surface2);padding:0.75rem;border-bottom:1px solid var(--border);border-radius:6px 6px 0 0;">
          <strong style="color:#44cc66;font-size:13px;">🏛️ EVACUATION CENTER</strong>
        </div>
        <div style="padding:0.75rem;">
          <div style="margin-bottom:0.75rem;"><strong style="color:#8892a8;font-size:11px;">${center.name}</strong></div>
          <div style="background:var(--bg);border-left:3px solid #44cc66;padding:0.5rem;border-radius:4px;margin-bottom:0.5rem;">
            <div style="font-size:9px;color:#8892a8;text-transform:uppercase;margin-bottom:0.25rem;">Capacity</div>
            <div style="color:#44cc66;font-weight:700;font-size:16px;">${center.capacity.toLocaleString()}</div>
            <div style="color:#8892a8;font-size:10px;margin-top:0.25rem;">people</div>
          </div>
          <div style="padding-top:0.5rem;border-top:1px solid var(--border);margin-top:0.5rem;font-size:10px;color:#8892a8;">✓ Ready for evacuation</div>
        </div>
      </div>
    `, { maxWidth: 280, className: 'custom-popup' });
    state.centerMarkers.addLayer(marker);
  }

  showRiskZoneInfoBox(radius, locationData);
  addMapLegend();
}

function showRiskZoneInfoBox(radius, locationData) {
  const schoolContainer = document.getElementById('risk-zone-school-box');
  const evacContainer = document.getElementById('risk-zone-evac-box');
  if (!schoolContainer || !evacContainer) return;

  const schools = locationData.schools || [];
  const centers = locationData.centers || [];
  const coords = VOLCANO_META[state.currentVolcano].coords;
  const depEd = getDepEdSchoolsInRadius(coords[0], coords[1], radius);
  const allSchools = [...schools, ...depEd.elementary, ...depEd.highSchool];

  const criticalCount = allSchools.filter(s => s.status === 'Critical').length;
  const priorityCount = allSchools.filter(s => s.status === 'Priority').length;
  const totalCapacity = centers.reduce((sum, c) => sum + c.capacity, 0);

  const buildList = (list, title) => {
    if (list.length === 0) return '';
    const items = list.map(s => {
      const color = STATUS_COLORS[s.status] || '#8892a8';
      const distance = s.distance ? ` • ${s.distance.toFixed(1)} km` : '';
      return `
        <div style="padding:0.35rem 0.45rem;background:var(--bg);border-left:3px solid ${color};border-radius:4px;margin-bottom:0.3rem;font-size:11px;">
          <div style="color:var(--text);margin-bottom:0.1rem;">📚 ${s.name}</div>
          <div style="color:${color};font-weight:600;font-size:10px;">${s.status}${distance}</div>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,107,53,0.2);">
        <div style="font-size:9px;font-weight:700;color:#ff8c2a;text-transform:uppercase;margin:0.5rem 0 0.3rem;">📚 ${title}</div>
        ${items}
      </div>`;
  };

  const schoolListHTML = buildList(schools, 'Alert Schools')
    + buildList(depEd.elementary, 'Elementary Schools')
    + buildList(depEd.highSchool, 'High Schools');

  const centerListHTML = centers.map(c => `
    <div style="padding:0.35rem 0.45rem;background:var(--bg);border-left:3px solid #44cc66;border-radius:4px;margin-bottom:0.3rem;font-size:11px;">
      <div style="color:var(--text);margin-bottom:0.1rem;">🏛️ ${c.name}</div>
      <div style="color:#44cc66;font-weight:600;font-size:10px;">${c.capacity.toLocaleString()} ppl</div>
    </div>`).join('');

  schoolContainer.innerHTML = `
    <div style="border:2px solid rgba(255,107,53,0.6);border-radius:10px;padding:0.8rem;background:linear-gradient(135deg,rgba(255,107,53,0.1) 0%,rgba(255,107,53,0.05) 100%);display:flex;flex-direction:column;height:100%;">
      <div style="margin-bottom:0.6rem;border-bottom:2px solid rgba(255,107,53,0.4);padding-bottom:0.4rem;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:#ff8c2a;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:0.15rem;">📚 School Risk Assessment</div>
        <div style="font-size:9px;font-weight:600;color:#ff6b35;text-transform:uppercase;letter-spacing:0.2px;">${radius} KM • ${allSchools.length} Schools</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem;margin-bottom:0.6rem;flex-shrink:0;">
        <div style="background:rgba(255,68,68,0.25);border:1px solid rgba(255,68,68,0.5);border-radius:4px;padding:0.35rem;text-align:center;">
          <div style="color:#ff4444;font-weight:900;font-size:16px;">${criticalCount}</div>
          <div style="color:#ff4444;font-size:10px;margin-top:0.05rem;text-transform:uppercase;letter-spacing:0.2px;font-weight:700;">Critical</div>
        </div>
        <div style="background:rgba(255,140,42,0.25);border:1px solid rgba(255,140,42,0.5);border-radius:4px;padding:0.35rem;text-align:center;">
          <div style="color:#ff8c2a;font-weight:900;font-size:16px;">${priorityCount}</div>
          <div style="color:#ff8c2a;font-size:10px;margin-top:0.05rem;text-transform:uppercase;letter-spacing:0.2px;font-weight:700;">Priority</div>
        </div>
      </div>
      <div style="overflow-y:auto;flex:1;min-height:0;padding-right:0.3rem;border-top:1px solid rgba(255,107,53,0.3);padding-top:0.4rem;font-size:11px;">
        ${schoolListHTML || '<div style="color:var(--text2);font-size:11px;text-align:center;">No schools</div>'}
      </div>
    </div>`;

  evacContainer.innerHTML = `
    <div style="border:2px solid rgba(68,204,102,0.6);border-radius:10px;padding:0.8rem;background:linear-gradient(135deg,rgba(68,204,102,0.1) 0%,rgba(68,204,102,0.05) 100%);display:flex;flex-direction:column;height:100%;">
      <div style="margin-bottom:0.6rem;border-bottom:2px solid rgba(68,204,102,0.4);padding-bottom:0.4rem;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:#3aaa55;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:0.15rem;">🏛️ Evacuation Risk Assessment</div>
        <div style="font-size:9px;font-weight:600;color:#44cc66;text-transform:uppercase;letter-spacing:0.2px;">${radius} KM • ${centers.length} Centers</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.4rem;margin-bottom:0.6rem;text-align:center;flex-shrink:0;">
        <div style="font-size:10px;color:var(--text2);margin-bottom:0.15rem;text-transform:uppercase;letter-spacing:0.2px;font-weight:700;">Capacity</div>
        <div style="font-size:18px;font-weight:900;color:#44cc66;line-height:1;">${totalCapacity.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:0.1rem;">ppl</div>
      </div>
      <div style="overflow-y:auto;flex:1;min-height:0;padding-right:0.3rem;border-top:1px solid rgba(68,204,102,0.3);padding-top:0.4rem;font-size:11px;">
        ${centerListHTML || '<div style="color:var(--text2);font-size:11px;text-align:center;">No centers</div>'}
      </div>
    </div>`;
}

function addMapLegend() {
  document.getElementById('map-legend')?.remove();
  const legend = document.createElement('div');
  legend.id = 'map-legend';
  legend.className = 'map-legend';
  legend.innerHTML = `
    <div class="legend-title">🗺️ Risk Zone Markers</div>
    <div class="legend-item"><div class="legend-dot" style="background-color:#ff4444;"></div><span style="color:#ff4444;">🏫 Critical School</span></div>
    <div class="legend-item"><div class="legend-dot" style="background-color:#ff8c2a;"></div><span style="color:#ff8c2a;">🏫 Priority School</span></div>
    <div class="legend-item"><div class="legend-dot" style="background-color:#ffc62a;"></div><span style="color:#ffc62a;">🏫 Moderate Risk</span></div>
    <div class="legend-item"><div class="legend-dot" style="background-color:#44cc66;"></div><span style="color:#44cc66;">🏫 Low Risk / 🏛️ Evac Center</span></div>`;
  document.getElementById('map').appendChild(legend);
}
