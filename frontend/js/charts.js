import { state } from './state.js';
import { THRESHOLDS } from './config.js';

const DAYS_BY_RANGE = { daily: 7, weekly: 28, monthly: 90, yearly: 365 };
const ERUPTION_LABEL = 'Eruption';
const ERUPTION_COLOR = '#ff0000';
export const STALTA_THRESHOLD = 2.0;

function daysToShow() {
  return DAYS_BY_RANGE[state.currentTimeRange] ?? 7;
}

export function getDataForTimeRange() {
  const data = state.dashboardData[state.currentVolcano] || [];
  const d = daysToShow();
  const offset = state.currentPeriodIndex * d;
  const end = data.length - offset;
  const start = Math.max(0, end - d);
  return data.slice(start, end);
}

export function updateNavigationButtons() {
  const data = state.dashboardData[state.currentVolcano] || [];
  const maxPeriods = Math.ceil(data.length / daysToShow());
  const btns = document.querySelectorAll('.nav-btn');
  if (btns.length >= 2) {
    btns[0].disabled = state.currentPeriodIndex >= maxPeriods - 1;
    btns[1].disabled = state.currentPeriodIndex <= 0;
  }
}

export function selectTimeRange(event, range) {
  state.currentTimeRange = range;
  state.currentPeriodIndex = 0;
  document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  updateTrendChart();
  updateNavigationButtons();
}

export function selectParameter(event, param) {
  state.currentParameter = param;
  document.querySelectorAll('.param-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  updateTrendChart();
}

export function navigatePeriod(direction) {
  const data = state.dashboardData[state.currentVolcano] || [];
  const maxPeriods = Math.ceil(data.length / daysToShow());
  if (direction === 'prev' && state.currentPeriodIndex < maxPeriods - 1) state.currentPeriodIndex++;
  else if (direction === 'next' && state.currentPeriodIndex > 0) state.currentPeriodIndex--;
  updateTrendChart();
  updateNavigationButtons();
}

function updateStats(data) {
  const avg = arr => {
    const nums = arr.map(v => parseFloat(v) || 0).filter(v => v > 0);
    return nums.length > 0 ? (nums.reduce((a, b) => a + b) / nums.length).toFixed(2) : '--';
  };
  document.getElementById('avg-veq').textContent = avg(data.map(d => d.VEQ));
  document.getElementById('avg-rockfall').textContent = avg(data.map(d => d.Rockfall));
  document.getElementById('avg-pdc').textContent = avg(data.map(d => d.PDCEvents));
  document.getElementById('avg-so2').textContent = avg(data.map(d => d.SO2Flux));
  document.getElementById('avg-plume').textContent = avg(data.map(d => d.PlumeHeight));
}

const ERUPTION_HOVER_PX = 6;

function eruptionLinesPlugin(indices) {
  let hovered = null;
  const linesVisible = chart => {
    const dsIndex = chart.data.datasets.findIndex(ds => ds.label === ERUPTION_LABEL);
    return dsIndex >= 0 && chart.isDatasetVisible(dsIndex) && indices.length > 0;
  };

  return {
    id: 'eruptionLines',
    afterEvent(chart, args) {
      const e = args.event;
      let next = null;
      if (e.type === 'mousemove' && linesVisible(chart)) {
        const { left, right, top, bottom } = chart.chartArea;
        if (e.x >= left && e.x <= right && e.y >= top && e.y <= bottom) {
          next = indices.find(i => Math.abs(chart.scales.x.getPixelForValue(i) - e.x) <= ERUPTION_HOVER_PX) ?? null;
        }
      }
      if (next !== hovered) {
        hovered = next;
        chart.canvas.style.cursor = hovered !== null ? 'pointer' : '';
        args.changed = true;
      }
    },
    afterDatasetsDraw(chart) {
      if (!linesVisible(chart)) return;
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      ctx.save();
      ctx.strokeStyle = ERUPTION_COLOR;
      ctx.shadowColor = ERUPTION_COLOR;
      ctx.setLineDash([3, 3]);
      for (const i of indices) {
        const px = x.getPixelForValue(i);
        const isHovered = i === hovered;
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.shadowBlur = isHovered ? 18 : 10;
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.stroke();
      }
      ctx.restore();

      if (hovered === null) return;
      drawHoverLabel(chart, `Eruption on ${chart.data.labels[hovered]}`, x.getPixelForValue(hovered), top + 6, ERUPTION_COLOR, 8);
    },
  };
}

// Dark label box centred on px, clamped to the chart area.
function drawHoverLabel(chart, text, px, boxY, color, glow = 0) {
  const { ctx, chartArea: { left, right } } = chart;
  ctx.save();
  ctx.font = '600 11px "JetBrains Mono", monospace';
  const padX = 8, boxH = 22;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxX = Math.min(Math.max(px - boxW / 2, left), right - boxW);
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, boxX + padX, boxY + boxH / 2);
  ctx.restore();
}

// Shows a label while the mouse is on the horizontal STA/LTA threshold line.
function thresholdHoverPlugin(label, value, color) {
  let hoverX = null;
  const lineVisible = chart => {
    const dsIndex = chart.data.datasets.findIndex(ds => ds.label === label);
    return dsIndex >= 0 && chart.isDatasetVisible(dsIndex);
  };

  return {
    id: 'thresholdHover',
    afterEvent(chart, args) {
      const e = args.event;
      let next = null;
      if (e.type === 'mousemove' && lineVisible(chart)) {
        const { left, right } = chart.chartArea;
        const py = chart.scales.y1.getPixelForValue(value);
        if (e.x >= left && e.x <= right && Math.abs(e.y - py) <= ERUPTION_HOVER_PX) next = e.x;
      }
      if (next !== hoverX) {
        hoverX = next;
        args.changed = true;
      }
    },
    afterDraw(chart) {
      if (hoverX === null || !lineVisible(chart)) return;
      const py = chart.scales.y1.getPixelForValue(value);
      drawHoverLabel(chart, `STA/LTA ${value.toFixed(1)} Threshold`, hoverX, Math.max(py - 30, chart.chartArea.top), color);
    },
  };
}

export function updateTrendChart() {
  const data = getDataForTimeRange();
  const ctx = document.getElementById('trendChart');
  if (state.trendChart) state.trendChart.destroy();
  if (data.length === 0) return;

  const dates = data.map(d => (d.DATE || '').toString().substring(0, 10));
  const datasets = [];
  const param = state.currentParameter;

  let eventsMax = 0, so2Max = 0, plumeMax = 0;

  const pushSeries = (key, label, color, group) => {
    const vals = data.map(d => parseFloat(d[key]) || 0);
    const localMax = Math.max(...vals);
    if (group === 'events') eventsMax = Math.max(eventsMax, localMax);
    else if (group === 'so2') so2Max = localMax;
    else if (group === 'plume') plumeMax = localMax;
    datasets.push({
      label,
      data: vals,
      borderColor: color,
      backgroundColor: color + '1a',
      tension: 0.4,
      fill: true,
      yAxisID: (group === 'so2' || group === 'plume') && param === 'all' ? 'y1' : 'y',
    });
  };

  if (param === 'all' || param === 'veq') pushSeries('VEQ', 'VEQ (events/day)', '#ff4444', 'events');
  if (param === 'all' || param === 'rockfall') pushSeries('Rockfall', 'Rockfall (events/day)', '#ffc62a', 'events');
  if (param === 'all' || param === 'pdc') pushSeries('PDCEvents', 'PDC (events/day)', '#44cc66', 'events');
  if (param === 'all' || param === 'so2') pushSeries('SO2Flux', 'SO₂ (tons/day)', '#4488ff', 'so2');
  if (param === 'all' || param === 'plume') pushSeries('PlumeHeight', 'Plume (m)', '#ff00ff', 'plume');

  let staltaMax = 0;
  let hasStalta = false;
  const STALTA_THRESHOLD_LABEL = `STA/LTA threshold (${STALTA_THRESHOLD.toFixed(1)})`;
  if (param === 'veq') {
    const stalta = data.map(d => {
      const v = parseFloat(d.STALTA);
      return isNaN(v) ? null : v;
    });
    const staltaValues = stalta.filter(v => v !== null);
    hasStalta = staltaValues.length > 0;
    staltaMax = Math.max(STALTA_THRESHOLD, ...staltaValues);
    datasets.push({
      type: 'bar',
      label: 'STA/LTA (ratio)',
      data: stalta,
      borderColor: '#ffa060',
      backgroundColor: '#ffa06066',
      borderWidth: 1,
      order: 1,
      yAxisID: 'y1',
    });
    // Only draw the threshold line when the visible window has STA/LTA readings.
    if (hasStalta) {
      datasets.push({
        label: STALTA_THRESHOLD_LABEL,
        data: dates.map(() => STALTA_THRESHOLD),
        borderColor: '#ffa060',
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        yAxisID: 'y1',
      });
    }
  }

  // Vertical dotted line on each eruption day. The dataset holds no points; it only
  // provides the legend entry (and toggle) for the lines drawn by eruptionLinesPlugin.
  const allData = state.dashboardData[state.currentVolcano] || [];
  const hasEruptionData = allData.some(d => d.eruption !== undefined && d.eruption !== '');
  const eruptionIdx = hasEruptionData
    ? data.map((d, i) => Number(d.eruption) === 1 ? i : -1).filter(i => i >= 0)
    : [];
  if (hasEruptionData) {
    datasets.push({
      label: ERUPTION_LABEL,
      data: dates.map(() => null),
      pointStyle: 'line',
      borderColor: ERUPTION_COLOR,
      backgroundColor: ERUPTION_COLOR,
      borderWidth: 2,
      borderDash: [3, 3],
      fill: false,
    });
  }

  eventsMax = eventsMax > 0 ? eventsMax * 1.1 : undefined;
  so2Max = so2Max > 0 ? so2Max * 1.1 : undefined;
  plumeMax = plumeMax > 0 ? plumeMax * 1.1 : undefined;

  let leftLabel = 'events/day', leftMax = eventsMax, rightLabel = '', rightMax;
  if (param === 'so2') { leftLabel = 'tons/day'; leftMax = so2Max; }
  else if (param === 'plume') { leftLabel = 'meters'; leftMax = plumeMax; }
  else if (param === 'all') { rightLabel = 'tons/day, meters'; rightMax = Math.max(so2Max || 0, plumeMax || 0); }
  else if (param === 'veq') { rightLabel = 'STA/LTA ratio'; rightMax = staltaMax * 1.1; }
  const showRight = param === 'all' || param === 'veq';

  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#8892a8',
            font: { family: 'JetBrains Mono', size: 10 },
            // usePointStyle is all-or-nothing, so give the other series square markers.
            usePointStyle: true,
            generateLabels: chart => Chart.defaults.plugins.legend.labels.generateLabels(chart)
              .map(item => item.text === ERUPTION_LABEL ? item : { ...item, pointStyle: 'rect' }),
            sort: (a, b) => (a.text === ERUPTION_LABEL) - (b.text === ERUPTION_LABEL),
          },
        },
        tooltip: {
          callbacks: {
            footer: items => items.length && eruptionIdx.includes(items[0].dataIndex) ? ERUPTION_LABEL : '',
          },
        },
      },
      scales: {
        y: {
          type: 'linear', display: true, position: 'left',
          ticks: { color: '#8892a8', stepSize: 1, callback: v => Math.round(v) },
          grid: { color: '#2a3040' }, beginAtZero: true, max: leftMax,
          title: { display: true, text: leftLabel, color: '#8892a8', font: { size: 10 } },
        },
        y1: {
          type: 'linear', display: showRight, position: 'right',
          ticks: param === 'veq'
            ? { color: '#8892a8', callback: v => v.toFixed(1) }
            : { color: '#8892a8', stepSize: 1, callback: v => Math.round(v) },
          grid: { drawOnChartArea: false }, beginAtZero: true, max: rightMax,
          title: { display: showRight, text: rightLabel, color: '#8892a8', font: { size: 10 } },
        },
        x: {
          offset: param === 'veq',
          ticks: { color: '#8892a8', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          grid: { color: '#2a3040' },
          title: { display: false },
        },
      },
    },
    plugins: [
      eruptionLinesPlugin(eruptionIdx),
      ...(hasStalta ? [thresholdHoverPlugin(STALTA_THRESHOLD_LABEL, STALTA_THRESHOLD, '#ffa060')] : []),
    ],
  });

  updateStats(data);
}

export function updateRadarChart() {
  const data = state.dashboardData[state.currentVolcano] || [];
  if (data.length === 0) return;
  const latest = data[data.length - 1];

  const pct = (value, t) => {
    value = parseFloat(value) || 0;
    if (value <= t.normal) return (value / t.normal) * 25;
    if (value <= t.elevated) return 25 + ((value - t.normal) / (t.elevated - t.normal)) * 25;
    if (value <= t.high) return 50 + ((value - t.elevated) / (t.high - t.elevated)) * 25;
    return 75 + Math.min(((value - t.high) / (t.critical - t.high)) * 25, 25);
  };

  const radarData = {
    VEQ: pct(latest.VEQ, THRESHOLDS.VEQ),
    Rockfall: pct(latest.Rockfall, THRESHOLDS.Rockfall),
    PDC: pct(latest.PDCEvents, THRESHOLDS.PDCEvents),
    SO2: pct(latest.SO2Flux, THRESHOLDS.SO2Flux),
    Plume: pct(latest.PlumeHeight, THRESHOLDS.PlumeHeight),
  };

  const ctx = document.getElementById('radarChart');
  if (!ctx) return;
  if (state.radarChart) state.radarChart.destroy();

  state.radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['VEQ', 'Rockfall', 'PDC Events', 'SO₂ Flux', 'Plume Height'],
      datasets: [{
        label: 'Current Levels',
        data: Object.values(radarData),
        backgroundColor: 'rgba(255,107,53,0.2)',
        borderColor: '#ff6b35',
        borderWidth: 2,
        pointBackgroundColor: '#ff6b35',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#ff6b35',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, color: '#5a6478', font: { family: 'JetBrains Mono', size: 9 }, backdropColor: 'transparent' },
          grid: { color: '#2a3040' },
          pointLabels: { color: '#8892a8', font: { family: 'JetBrains Mono', size: 10, weight: 600 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.8)', titleColor: '#fff', bodyColor: '#fff',
          borderColor: '#ff6b35', borderWidth: 1, padding: 8,
          titleFont: { size: 11, weight: 600 }, bodyFont: { size: 10 },
        },
      },
    },
  });
}
