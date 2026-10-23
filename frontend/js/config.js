export const VOLCANO_META = {
  Kanlaon: {
    coords: [10.4113, 123.1324],
    elevation: '2465 m',
    type: 'Stratovolcano',
    location: 'Negros Island, Negros Occidental',
    zoomLevel: 11,
  },
  Mayon: {
    coords: [13.2555, 123.6862],
    elevation: '2463 m',
    type: 'Stratovolcano',
    location: 'Bicol Region, Albay',
    zoomLevel: 11,
  },
  Taal: {
    coords: [14.0106, 120.9986],
    elevation: '311 m',
    type: 'Caldera Complex',
    location: 'Calabarzon Region, Batangas',
    zoomLevel: 11,
  },
};

export const ZONES = {
  6: { pop: 7186, area: 113.1, radius: 6000, color: '#44cc66', kmToSafeZone: 8 },
  8: { pop: 38088, area: 201.1, radius: 8000, color: '#ffc62a', kmToSafeZone: 10 },
  10: { pop: 184376, area: 314.2, radius: 10000, color: '#ff4444', kmToSafeZone: 15 },
};

export const THRESHOLDS = {
  VEQ: { normal: 50, elevated: 100, high: 200, critical: 300 },
  Rockfall: { normal: 100, elevated: 200, high: 300, critical: 500 },
  PDCEvents: { normal: 2, elevated: 5, high: 10, critical: 20 },
  SO2Flux: { normal: 500, elevated: 1000, high: 1500, critical: 2500 },
  PlumeHeight: { normal: 500, elevated: 1000, high: 1500, critical: 2500 },
};

export const LIVE_FEEDS = {
  Mayon: {
    type: 'youtube',
    embed: '<a href="https://youtu.be/UDAZWxehMAI" target="_blank" style="display:block;position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden;text-decoration:none;"><img src="https://img.youtube.com/vi/UDAZWxehMAI/maxresdefault.jpg" style="width:100%;height:100%;object-fit:cover;opacity:0.85;" onerror="this.src=\'https://img.youtube.com/vi/UDAZWxehMAI/hqdefault.jpg\'"/><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;"><div style="width:64px;height:64px;background:rgba(255,0,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="30" height="30" fill="white"><polygon points="9,7 17,12 9,17"/></svg></div><span style="color:#fff;font-family:JetBrains Mono,monospace;font-size:12px;background:rgba(0,0,0,0.6);padding:4px 10px;border-radius:4px;">&#128308; Watch Live on YouTube</span></div></a>',
  },
  Kanlaon: { type: 'none', url: null },
  Taal: { type: 'none', url: null },
};

export const NEWS_DATA = {
  Mayon: [
    { title: 'PHIVOLCS Mayon Volcano Bulletin', description: 'Official volcanic activity bulletin with seismic monitoring and alert level status', url: 'https://www.phivolcs.dost.gov.ph/' },
    { title: 'Inquirer - Mayon Volcano News', description: 'Latest news and updates on Mayon Volcano activity', url: 'https://newsinfo.inquirer.net/tag/mayon-volcano' },
    { title: 'GMA News - Mayon Volcano', description: "Real-time coverage of Mayon's volcanic activity from GMA Network", url: 'https://www.gmanetwork.com/news/topic/mayon-volcano' },
    { title: 'ABS-CBN News - Mayon Volcano', description: 'Latest developments and on-ground reports from Albay province', url: 'https://news.abs-cbn.com/tag/mayon-volcano' },
  ],
  Kanlaon: [
    { title: 'PHIVOLCS Kanlaon Volcano Bulletin', description: 'Official bulletin on Kanlaon volcanic activity and monitoring', url: 'https://www.phivolcs.dost.gov.ph/' },
    { title: 'Inquirer - Kanlaon Volcano News', description: 'News and updates from Negros Island about Kanlaon volcano', url: 'https://newsinfo.inquirer.net/tag/kanlaon-volcano' },
    { title: 'GMA News - Kanlaon Volcano', description: 'Coverage of Visayas region including Kanlaon monitoring', url: 'https://www.gmanetwork.com/news/topic/kanlaon-volcano' },
    { title: 'ABS-CBN News - Kanlaon Volcano', description: 'Real-time coverage and monitoring of Kanlaon activity', url: 'https://news.abs-cbn.com/tag/kanlaon-volcano' },
  ],
  Taal: [
    { title: 'PHIVOLCS Taal Volcano Bulletin', description: 'Official volcanic activity bulletin for Taal Volcano', url: 'https://www.phivolcs.dost.gov.ph/' },
    { title: 'Inquirer - Taal Volcano News', description: 'Comprehensive reporting on Taal Volcano unrest and evacuations', url: 'https://newsinfo.inquirer.net/tag/taal-volcano' },
    { title: 'GMA News - Taal Volcano', description: 'Latest updates on Taal Volcano from GMA Network', url: 'https://www.gmanetwork.com/news/topic/taal-volcano' },
    { title: 'ABS-CBN News - Taal Volcano', description: 'Real-time coverage of Taal and surrounding regions', url: 'https://news.abs-cbn.com/tag/taal-volcano' },
  ],
};

export const KANLAON_FOLDER_ID = '1hBAjQgoi_BGcM8yaAR5kBDlS0PeKQ6Wn';
export const KANLAON_SNAPSHOTS = {
  '022226': './assets/images/snap022226.png',
};
export const SNAPSHOT_REFRESH_INTERVAL = 300000;

export const VOLCANO_SNAPSHOT_FILES = {
  Kanlaon: './data/kanlaon.json',
  Mayon: './data/mayon.json',
  Taal: './data/taal.json',
};

export const SCHOOLS_URL = './data/deped_schools.json';

// USGS Ash3d final deposit thickness isopachs (GeoJSON, converted with
// scripts/shp2geojson.py). Volcanoes set to null show an empty state.
export const ASH_DEPOSIT_MODELS = {
  Kanlaon: { url: './data/kanlaon_ash_deposit_2024-06-03.geojson', title: 'Kanlaon 3 June 2024 Eruption' },
  Mayon: null,
  Taal: null,
};
