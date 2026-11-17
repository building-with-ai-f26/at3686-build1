// Daily history of the Burst Index, and the charts that draw it.
//
// Each past day is recalculated with the same scoring as today's score
// (signals.js), from:
//   - Polymarket: each market's daily "Yes" price history (real past prices)
//   - OpenRouter: models released before that day, at today's listed prices (approximate)
//   - Manual signal: the quarterly figure in effect that day
import {
  BANDS,
  indexScore,
  getJson,
  polymarketSubScore,
  openRouterTrendAt,
  manualAt,
  manualSubScore,
} from "./signals.js";

// First day all three Polymarket markets have data, so the index is consistent.
export const HISTORY_START = "2026-10-23";

const DAY_MS = 86400000;

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function formatDate(isoDate, withYear = false) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// One market's daily "Yes" price as a Map of "YYYY-MM-DD" → price (0–1).
async function fetchYesHistory(token) {
  const { history } = await getJson(`https://clob.polymarket.com/prices-history?market=${token}&interval=max&fidelity=1440`);
  const byDate = new Map();
  for (const point of history) byDate.set(new Date(point.t * 1000).toISOString().slice(0, 10), point.p);
  return byDate;
}

// Returns one row per day from HISTORY_START to today:
// { date, polymarket, openrouter, manual, index } (sub-scores may be null).
export async function loadHistory(markets, models) {
  const results = await Promise.allSettled(markets.map((m) => fetchYesHistory(m.yesToken)));
  const histories = results.filter((r) => r.status === "fulfilled").map((r) => r.value);

  // Carry each market's last known price forward over days with no trade.
  const lastKnown = histories.map((h) => {
    let value;
    for (const [date, price] of [...h.entries()].sort()) if (date < HISTORY_START) value = price;
    return value;
  });

  const rows = [];
  const end = todayIso();
  for (let date = HISTORY_START; date <= end; date = addDays(date, 1)) {
    histories.forEach((h, i) => { if (h.has(date)) lastKnown[i] = h.get(date); });
    const yesValues = lastKnown.filter(Number.isFinite);
    const endOfDay = Date.parse(`${addDays(date, 1)}T00:00:00Z`) / 1000;
    const sub = {
      polymarket: polymarketSubScore(yesValues)?.score ?? null,
      openrouter: models ? openRouterTrendAt(models, endOfDay)?.score ?? null : null,
      manual: manualSubScore(manualAt(date)),
    };
    rows.push({ date, ...sub, index: indexScore(sub) });
  }
  return rows;
}

// --- Drawing ---------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// Main chart: the index over the selected range, 0–100 with band names on the right.
// `tooltip` is an HTML element positioned over the chart; `describe(row)` fills it.
export function drawIndexChart(container, rows, describe) {
  container.querySelector("svg")?.remove();
  const tooltip = container.querySelector(".tooltip");
  tooltip.hidden = true;
  const points = rows.filter((r) => Number.isFinite(r.index));
  if (points.length < 2) {
    container.querySelector(".chart-empty").hidden = false;
    return;
  }
  container.querySelector(".chart-empty").hidden = true;

  const width = container.clientWidth;
  const height = 260;
  const margin = { top: 12, right: 64, bottom: 28, left: 32 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const x = (i) => margin.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => margin.top + (1 - v / 100) * plotH;

  const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });

  // Gridlines at each band edge, value ticks on the left, band names on the right.
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    svg.append(svgEl("line", { x1: margin.left, x2: margin.left + plotW, y1: y(tick), y2: y(tick), class: tick === 0 ? "axis" : "grid" }));
    const label = svgEl("text", { x: margin.left - 8, y: y(tick) + 4, "text-anchor": "end", class: "tick" });
    label.textContent = tick;
    svg.append(label);
  }
  let lower = 0;
  for (const band of BANDS) {
    const label = svgEl("text", { x: margin.left + plotW + 10, y: y((lower + band.max) / 2) + 4, class: "band-label" });
    label.textContent = band.name;
    svg.append(label);
    lower = band.max;
  }

  // Date labels: first, middle, last.
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  labelIdx.forEach((i, n) => {
    const anchor = n === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
    const label = svgEl("text", { x: x(i), y: height - 8, "text-anchor": anchor, class: "tick" });
    label.textContent = formatDate(points[i].date);
    svg.append(label);
  });

  const line = points.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.index).toFixed(1)}`).join(" ");
  svg.append(svgEl("path", { d: `${line} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`, class: "area" }));
  svg.append(svgEl("path", { d: line, class: "line" }));
  const last = points.length - 1;
  svg.append(svgEl("circle", { cx: x(last), cy: y(points[last].index), r: 4, class: "dot" }));

  // Hover layer: a crosshair that snaps to the nearest day.
  const crosshair = svgEl("line", { y1: margin.top, y2: margin.top + plotH, class: "crosshair", visibility: "hidden" });
  const hoverDot = svgEl("circle", { r: 4, class: "dot", visibility: "hidden" });
  svg.append(crosshair, hoverDot);
  const hitArea = svgEl("rect", { x: margin.left, y: 0, width: plotW, height, fill: "transparent" });
  svg.append(hitArea);

  const show = (i) => {
    const p = points[i];
    crosshair.setAttribute("x1", x(i));
    crosshair.setAttribute("x2", x(i));
    crosshair.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", x(i));
    hoverDot.setAttribute("cy", y(p.index));
    hoverDot.setAttribute("visibility", "visible");
    describe(tooltip, p);
    tooltip.hidden = false;
    const left = Math.min(Math.max(x(i) - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
    tooltip.style.left = `${left}px`;
  };
  const hide = () => {
    crosshair.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const i = Math.round(((clientX - box.left - margin.left) / plotW) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };
  hitArea.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  hitArea.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
  hitArea.addEventListener("pointerleave", hide);

  // Keyboard: focus the chart, then use ← / → to move between days.
  let focused = last;
  container.onfocus = () => show(focused);
  container.onblur = hide;
  container.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    focused = Math.max(0, Math.min(last, focused + (e.key === "ArrowRight" ? 1 : -1)));
    show(focused);
  };

  container.prepend(svg);
}

// Small trend line for a signal card (sub-score over the selected range).
export function sparkline(rows, key) {
  const values = rows.map((r) => r[key]).filter(Number.isFinite);
  if (values.length < 2) return "";
  const w = 88;
  const h = 28;
  const pad = 4;
  // Scale to this signal's own min–max; a flat signal draws through the middle.
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) { min -= 1; max += 1; }
  const span = max - min;
  const px = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const py = (v) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" /><circle cx="${px(last)}" cy="${py(values[last])}" r="3" /></svg>`;
}
