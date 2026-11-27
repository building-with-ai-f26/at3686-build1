// Burst or Not app: range tabs, refresh, chart, signal cards, and data table.
// Loaded by docs/app/index.html as a module (moved out of the page so the
// Content-Security-Policy can forbid inline scripts).
import {
  SIGNALS, MANUAL_SIGNAL, bandFor, indexScore, escapeHtml, signalLevel,
  fetchPolymarketMarkets, polymarketSubScore,
  fetchOpenRouterModels, openRouterTrendAt,
  manualAt, manualSubScore,
} from "./signals.js";
import { loadHistory, drawIndexChart, sparkline, todayIso, formatDate } from "./history.js";
import { initCongressPanel } from "./congress.js";

const RANGES = { "1W": 7, "1M": 30, "3M": 90, All: Infinity };
const RANGE_WORDS = { "1W": "past week", "1M": "past month", "3M": "past 3 months" };
const SHORT_NAMES = { polymarket: "Polymarket", openrouter: "OpenRouter", manual: "VC share" };
let range = "1M";
let state = null; // { rows, live }

// Fetch today's signals and the daily history. Today's point uses the live
// values, so the chart always ends at the headline number.
async function loadAll() {
  const [marketsResult, modelsResult] = await Promise.allSettled([fetchPolymarketMarkets(), fetchOpenRouterModels()]);
  const markets = marketsResult.status === "fulfilled" ? marketsResult.value : [];
  const models = modelsResult.status === "fulfilled" ? modelsResult.value : null;
  const today = todayIso();
  const live = {
    markets,
    polymarket: polymarketSubScore(markets.map((m) => m.yes)),
    openrouter: models ? openRouterTrendAt(models, Date.now() / 1000) : null,
    manual: manualAt(today),
    errors: {
      polymarket: marketsResult.reason?.message || (markets.length ? null : "no markets loaded"),
      openrouter: modelsResult.reason?.message || "too few models to compare",
    },
  };

  let rows = [];
  try { rows = await loadHistory(markets, models); } catch { rows = []; }
  const sub = {
    polymarket: live.polymarket?.score ?? null,
    openrouter: live.openrouter?.score ?? null,
    manual: manualSubScore(live.manual),
  };
  const todayRow = { date: today, ...sub, index: indexScore(sub) };
  if (rows.at(-1)?.date === today) rows[rows.length - 1] = todayRow;
  else rows.push(todayRow);

  // Only compare like with like: a past day counts toward the chart only if it
  // has every signal today has (e.g. if price history fails to load, the
  // history is left blank instead of showing a fake jump).
  const todaySignals = SIGNALS.map((s) => s.id).filter((id) => Number.isFinite(todayRow[id]));
  for (const row of rows) {
    if (todaySignals.some((id) => !Number.isFinite(row[id]))) row.index = null;
  }
  return { rows, live };
}

function rowsInRange() {
  const days = RANGES[range];
  return Number.isFinite(days) ? state.rows.slice(-(days + 1)) : state.rows;
}

const fmtIndex = (v) => (Number.isFinite(v) ? v.toFixed(1) : "–");
const fmtSub = (v) => (Number.isFinite(v) ? Math.round(v) : "–");
const arrow = (d) => (d > 0 ? "▲" : d < 0 ? "▼" : "■");

function renderHeadline(rows) {
  const first = rows[0];
  const last = rows.at(-1);
  document.getElementById("value").textContent = fmtIndex(last.index);
  if (Number.isFinite(last.index)) {
    const band = bandFor(last.index);
    document.getElementById("band-name").textContent = band.name;
    document.getElementById("band-dot").style.background = `var(--band-${band.name.toLowerCase()})`;
    // Plain-English headline: "52 / Hot: AI hype is running above fundamentals. ..."
    const strong = document.createElement("strong");
    strong.textContent = `${Math.round(last.index)} / ${band.name}:`;
    document.getElementById("headline").replaceChildren(strong, ` ${band.meaning} Higher = more bubble risk, not a crash date.`);
  } else {
    document.getElementById("headline").textContent = "The Burst Index couldn't be calculated right now. Try Refresh signals.";
  }
  const delta = document.getElementById("delta");
  if (rows.length > 1 && Number.isFinite(first.index) && Number.isFinite(last.index)) {
    const diff = last.index - first.index;
    const pct = (diff / first.index) * 100;
    const period = rows.length === RANGES[range] + 1 ? RANGE_WORDS[range] : `since ${formatDate(first.date)}`;
    delta.textContent = `${arrow(diff)} ${Math.abs(diff).toFixed(1)} pts (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%) · ${period}`;
  } else {
    delta.textContent = "Not enough history for this range yet.";
  }
  const loaded = ["polymarket", "openrouter", "manual"].filter((k) => Number.isFinite(last[k])).length;
  document.getElementById("updated").textContent =
    `${loaded} of ${SIGNALS.length} signals · Updated ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

// Which signal moved the index most over the range (its share of the index change).
function renderDriver(rows) {
  const first = rows[0];
  const last = rows.at(-1);
  const counted = SIGNALS.filter((s) => Number.isFinite(last[s.id])).length;
  const moves = SIGNALS
    .filter((s) => Number.isFinite(first[s.id]) && Number.isFinite(last[s.id]))
    .map((s) => ({ s, from: first[s.id], to: last[s.id], effect: (last[s.id] - first[s.id]) / counted }))
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const el = document.getElementById("driver");
  const top = moves[0];
  if (rows.length < 2 || !Number.isFinite(first.index)) {
    el.textContent = "";
    return;
  }
  if (!top || Math.abs(top.effect) < 0.5) {
    el.textContent = "No single signal moved the index much over this range.";
    return;
  }
  el.innerHTML = `Biggest driver: <strong>${escapeHtml(top.s.name)}</strong>, ${arrow(top.effect)} ${Math.abs(top.effect).toFixed(1)} index pts (sub-score ${Math.round(top.from)} → ${Math.round(top.to)})`;
}

function describePoint(tooltip, row) {
  tooltip.replaceChildren();
  const add = (cls, parts) => {
    const div = document.createElement("div");
    div.className = cls;
    for (const [text, strong] of parts) {
      const node = strong ? document.createElement("strong") : document.createTextNode(text);
      if (strong) node.textContent = text;
      div.append(node);
    }
    tooltip.append(div);
  };
  add("tt-date", [[formatDate(row.date, true)]]);
  add("tt-main", [[fmtIndex(row.index), true], [` Burst Index · ${bandFor(row.index).name}`]]);
  for (const s of SIGNALS) add("tt-row", [[String(fmtSub(row[s.id])), true], [` ${SHORT_NAMES[s.id]}`]]);
}

function cardContent(id) {
  const { live } = state;
  if (id === "polymarket" && live.polymarket) {
    return {
      headline: `Average "Yes" chance: ${(live.polymarket.avgYes * 100).toFixed(1)}%`,
      body: `<ul>${live.markets.map((m) => `<li><a href="${m.url}" target="_blank" rel="noopener">${escapeHtml(m.question)}</a>: ${(m.yes * 100).toFixed(1)}%${m.endDate ? ` <span class="meta">(ends ${formatDate(m.endDate.slice(0, 10), true)})</span>` : ""}</li>`).join("")}</ul>
        <p class="meta">How it's scored: average odds of 5% or less → 0 (no bubble signs); 50% or more → 100 (strong bubble signs); in between scales evenly. ${live.markets.length} of 3 markets loaded.</p>`,
    };
  }
  if (id === "openrouter" && live.openrouter) {
    const t = live.openrouter;
    const change = (t.ratio - 1) * 100;
    return {
      headline: Math.abs(change) < 0.5
        ? "Last 6 months' models launched at about the same price as the year before"
        : `Last 6 months' models launched ${Math.abs(change).toFixed(0)}% ${change < 0 ? "cheaper" : "pricier"} than the year before`,
      body: `<p>Compares the median price of paid models released on OpenRouter in the last 6 months with those released in the year before; ":batch" discount copies of existing models are left out.</p>
        <ul>
          <li>Released in the last 6 months: median $${t.recentMedian.toFixed(2)} per million input tokens (${t.recentCount} paid models)</li>
          <li>Released 6–18 months ago: median $${t.priorMedian.toFixed(2)} (${t.priorCount} paid models)</li>
        </ul>
        <p class="meta">How it's scored: new models 20% pricier or more → 0 (no bubble signs); 40% cheaper or more → 100 (strong bubble signs); in between scales evenly.</p>
        <p class="note">Falling prices can also reflect efficiency gains, so this signal is directional, not definitive.</p>`,
    };
  }
  if (id === "manual" && live.manual) {
    const m = live.manual;
    return {
      headline: `<strong class="signal-figure">${m.value}%</strong> of global VC funding went to AI · ${escapeHtml(MANUAL_SIGNAL.source)}, ${escapeHtml(m.quarter)}`,
      body: `<ul>${MANUAL_SIGNAL.values.map((v) => `<li>${escapeHtml(v.quarter)}: ${v.approx ? "~" : ""}${v.value}%${v === m ? " (current)" : ""}</li>`).join("")}</ul>
        <p class="meta">How it's scored: 20% or less → 0 (no bubble signs); 80% or more → 100 (strong bubble signs); in between scales evenly. Source: ${escapeHtml(MANUAL_SIGNAL.source)}, ${escapeHtml(m.quarter)}, entered by hand each quarter.</p>`,
    };
  }
  return null;
}

function renderCards(rows) {
  const today = state.rows.at(-1);
  for (const s of SIGNALS) {
    const card = document.getElementById(`signal-${s.id}`);
    const content = cardContent(s.id);
    const name = `<span class="signal-name">${escapeHtml(s.name)}</span><br><span class="signal-measures">${escapeHtml(s.measures)}</span>`;
    card.innerHTML = content
      ? `<summary><span class="signal-text">${name}<br><span class="meta">${content.headline}</span></span>
          ${sparkline(rows, s.id)}<span class="signal-score"><span>${fmtSub(today[s.id])}<span class="signal-unit">/100</span></span><span class="signal-level">${signalLevel(today[s.id])}</span></span></summary>
         <div class="signal-body">${content.body}</div>`
      : `<summary><span class="signal-text">${name}<br><span class="meta">Unavailable</span></span><span class="signal-score">–</span></summary>
         <div class="signal-body"><p class="meta">Could not load this signal (${escapeHtml(state.live.errors[s.id] || "unknown error")}). It is left out of the index.</p></div>`;
  }
}

function renderTable(rows) {
  const head = `<tr><th>Date</th><th>Burst Index</th>${SIGNALS.map((s) => `<th>${SHORT_NAMES[s.id]}</th>`).join("")}</tr>`;
  const body = [...rows].reverse()
    .map((r) => `<tr><td>${formatDate(r.date, true)}</td><td>${fmtIndex(r.index)}</td>${SIGNALS.map((s) => `<td>${fmtSub(r[s.id])}</td>`).join("")}</tr>`)
    .join("");
  document.getElementById("table").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function render() {
  const rows = rowsInRange();
  renderHeadline(rows);
  drawIndexChart(document.getElementById("chart"), rows, describePoint);
  renderDriver(rows);
  renderCards(rows);
  renderTable(rows);
}

async function main() {
  document.getElementById("signals").innerHTML = SIGNALS.map(
    (s) => `<details class="signal" id="signal-${s.id}"><summary><span class="signal-text"><span class="signal-name">${escapeHtml(s.name)}</span><br><span class="meta">Loading…</span></span></summary></details>`
  ).join("");

  // Analytics: record which signal cards people open.
  SIGNALS.forEach((s) => {
    document.getElementById(`signal-${s.id}`).addEventListener("toggle", (event) => {
      if (event.target.open) window.posthog?.capture("signal_card_opened", { signal: s.id });
    });
  });

  document.getElementById("ranges").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button || !state) return;
    range = button.dataset.range;
    document.querySelectorAll("#ranges button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
    window.posthog?.capture("chart_range_changed", { range });
  });

  const refresh = document.getElementById("refresh");
  const overview = document.getElementById("overview");
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    refresh.textContent = "Refreshing…";
    overview.classList.add("refreshing");
    state = await loadAll();
    render();
    overview.classList.remove("refreshing");
    const today = state.rows.at(-1);
    window.posthog?.capture("signals_refreshed", {
      froth_score: Number(fmtIndex(today.index)),
      signals_loaded: SIGNALS.filter((s) => Number.isFinite(today[s.id])).length,
    });
    refresh.textContent = "Refresh signals";
    refresh.disabled = false;
  });

  let resizeFrame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => state && drawIndexChart(document.getElementById("chart"), rowsInRange(), describePoint));
  });

  state = await loadAll();
  render();
  refresh.disabled = false;
}

main();
initCongressPanel(); // independent of the Burst Index; loads in parallel
