// "Capitol Hill AI trades" panel. Not part of the Burst Index.
//
// - The buys/sells chart reads ../data/congress-ai-summary.json: aggregates
//   built daily by scripts/update-congress-summary.mjs (no raw trade records,
//   per Bargo's terms).
// - Member search calls Bargo live from the visitor's own browser (no key, so
//   each visitor has Bargo's free per-day limit). Results are shown, never stored.
import { AI_TICKERS, AMOUNT_FILTERS, BARGO_API, normalizeName, partyFor, partyBucket } from "./congress-common.js";
import { escapeHtml } from "./signals.js";

// Rows per search. Without a key, Bargo allows 100 rows per network address per
// day, shared by everyone on the same Wi-Fi, so 10 rows ≈ 10 searches a day.
const SEARCH_LIMIT = 10;
const TRACKED = new Set(AI_TICKERS);
const PARTY_PLURAL = { Democrat: "Democrats", Republican: "Republicans", Independent: "Independents", Unknown: "Party unknown" };
const CHAMBER = { house: "House", senate: "Senate" };
const DAY_MS = 86400000;

// Member search input: 2–60 characters of letters (accents allowed), spaces,
// and . ' ’ - (e.g. "O'Rourke", "Wasserman Schultz"). Checked before any
// request, for both the search box and shared ?member= links.
export const QUERY_MAX = 60;
const NAME_PATTERN = /^[\p{L}][\p{L} .'’-]*$/u;

export function checkQuery(raw) {
  const query = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (query.length < 2) return { error: "Type at least 2 letters of a member's name." };
  if (query.length > QUERY_MAX) return { error: `Use ${QUERY_MAX} characters or fewer: a last name is enough.` };
  if (!NAME_PATTERN.test(query)) return { error: "Use letters only (spaces, periods, apostrophes, and hyphens are fine)." };
  return { query };
}

let partyLookup = { house: {}, senate: {} };

// --- Trade-size filter ----------------------------------------------------------
// 0 = all sizes. Applies to the summary chart (precomputed counts in the summary
// file) and to member search results (filtered in the browser).
let minAmount = 0;
let lastResults = null; // { trades, callsLeft } from the latest search, re-shown when the filter changes
const SIZE_OPTIONS = [{ min: 0, label: "All sizes" }, ...AMOUNT_FILTERS];
const sizeLabel = () => SIZE_OPTIONS.find((o) => o.min === minAmount)?.label || "All sizes";
const fitsSize = (t) => !minAmount || Number(t.amount_low) >= minAmount;

function renderFilter() {
  return `<div class="cg-filter">
      <span class="cg-filter-label">Trade size</span>
      <div class="ranges cg-filter-buttons" role="group" aria-label="Filter by disclosed trade size">${SIZE_OPTIONS.map(
        (o) => `<button type="button" data-min="${o.min}" aria-pressed="${o.min === minAmount}">${escapeHtml(o.label)}</button>`
      ).join("")}</div>
    </div>
    <p class="meta cg-filter-note">Amounts are disclosed as ranges (for example $15,001–$50,000), so a trade counts when the low end of its range meets the filter.</p>`;
}

// The summary as seen through the filter. Size-filtered data holds counts only
// (no amounts or tickers, so tiny groups can't be traced to one trade), so
// `filtered` tells the chart, notes, and tables to leave those parts out.
function viewFor(summary) {
  const f = minAmount && summary.amount_filters?.find((x) => x.min === minAmount);
  if (!f) return summary;
  const unknown = f.by_group.filter((g) => g.party === "Unknown").reduce((n, g) => n + g.buys + g.sells, 0);
  // Keep every group from the full view (with 0s), so the chart rows don't jump around.
  const byGroup = summary.by_group.map(({ chamber, party }) =>
    f.by_group.find((g) => g.chamber === chamber && g.party === party) || { chamber, party, buys: 0, sells: 0 });
  return { ...summary, filtered: true, by_group: byGroup, by_ticker: [],
    totals: { ...f.totals, exchanges: f.totals.trades - f.totals.buys - f.totals.sells, unmatched_party: unknown } };
}

const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const range = (low, high, openEnded) => (openEnded ? `${usd(low)}+` : `${usd(low)}–${usd(high)}`);
const fmtDate = (iso, year = true) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "–";

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// --- Summary chart -------------------------------------------------------

function groupLabel(g) {
  return `${CHAMBER[g.chamber] || g.chamber} · ${PARTY_PLURAL[g.party] || g.party}`;
}

// Diverging bars: sells grow left from the center line, buys grow right.
function renderChart(summary) {
  const order = ["house|Democrat", "house|Republican", "senate|Democrat", "senate|Republican"];
  const groups = [...summary.by_group].sort((a, b) => {
    const ia = order.indexOf(`${a.chamber}|${a.party}`);
    const ib = order.indexOf(`${b.chamber}|${b.party}`);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || groupLabel(a).localeCompare(groupLabel(b));
  });
  const max = Math.max(1, ...groups.flatMap((g) => [g.buys, g.sells]));
  const bar = (side, g) => {
    const count = side === "buy" ? g.buys : g.sells;
    const amount = summary.filtered ? "" : `, ${range(g[`${side}_amount_low`], g[`${side}_amount_high`], g.open_ended > 0)} disclosed`;
    const label = `${groupLabel(g)}: ${count} ${side}${count === 1 ? "" : "s"}${amount}`;
    return `<div class="cg-half cg-${side}">
        <span class="cg-bar" style="width:${(count / max) * 100}%" tabindex="0" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}"></span>
        <span class="cg-count">${count}</span>
      </div>`;
  };
  return `<div class="cg-legend" aria-hidden="true">
      <span><i class="cg-key cg-key-sell"></i>Sells</span><span><i class="cg-key cg-key-buy"></i>Buys</span>
    </div>
    <div class="cg-chart" role="group" aria-label="Buys and sells of AI stocks by chamber and party">
      ${groups.map((g) => `<div class="cg-row"><div class="cg-label">${escapeHtml(groupLabel(g))}</div>${bar("sell", g)}${bar("buy", g)}</div>`).join("")}
    </div>`;
}

function renderTables(summary) {
  if (summary.filtered) {
    const rows = summary.by_group.map((g) => `<tr><td>${escapeHtml(groupLabel(g))}</td><td>${g.buys}</td><td>${g.sells}</td></tr>`).join("");
    return `<details class="cg-tables"><summary>Show table</summary>
      <div class="table-scroll"><table><thead><tr><th>Group</th><th>Buys</th><th>Sells</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="meta">With a size filter on, only counts are shown: no amounts or tickers, so small groups can't be traced to a single trade.</p>
    </details>`;
  }
  const groupRows = summary.by_group
    .map((g) => `<tr><td>${escapeHtml(groupLabel(g))}</td><td>${g.buys}</td><td>${g.sells}</td>
      <td>${range(g.buy_amount_low, g.buy_amount_high, false)}</td><td>${range(g.sell_amount_low, g.sell_amount_high, false)}</td></tr>`)
    .join("");
  const tickerRows = summary.by_ticker
    .map((t) => `<tr><td>${escapeHtml(t.ticker)}</td><td>${t.buys}</td><td>${t.sells}</td></tr>`)
    .join("");
  return `<details class="cg-tables"><summary>Show tables</summary>
      <div class="table-scroll"><table><thead><tr><th>Group</th><th>Buys</th><th>Sells</th><th>Buy amounts</th><th>Sell amounts</th></tr></thead><tbody>${groupRows}</tbody></table></div>
      <div class="table-scroll"><table><thead><tr><th>Ticker</th><th>Buys</th><th>Sells</th></tr></thead><tbody>${tickerRows}</tbody></table></div>
    </details>`;
}

function renderNotes(summary) {
  const t = summary.totals;
  const lag = summary.disclosure_lag_days;
  const allBuys = summary.by_group.reduce((s, g) => [s[0] + g.buy_amount_low, s[1] + g.buy_amount_high], [0, 0]);
  const allSells = summary.by_group.reduce((s, g) => [s[0] + g.sell_amount_low, s[1] + g.sell_amount_high], [0, 0]);
  return `<p class="cg-totals">${summary.filtered ? `Trades of <strong>${escapeHtml(sizeLabel())}</strong>: ` : ""}<strong>${t.trades}</strong> disclosed trade${t.trades === 1 ? "" : "s"}: <strong>${t.buys}</strong> buy${t.buys === 1 ? "" : "s"}, <strong>${t.sells}</strong> sell${t.sells === 1 ? "" : "s"}${t.exchanges ? `, ${t.exchanges} exchange${t.exchanges === 1 ? "" : "s"}` : ""}.${
      summary.filtered ? "" : `
      Disclosed amounts: buys ${usd(allBuys[0])}–${usd(allBuys[1])}, sells ${usd(allSells[0])}–${usd(allSells[1])}.`}</p>
    <ul class="cg-notes meta">
      <li><strong>Up to 45 days late by law.</strong> Members have up to 45 days to disclose a trade, so recent trades may not appear yet.${
        Number.isFinite(lag.median) ? ` In this data the median gap from trade to disclosure was ${Math.round(lag.median)} days (longest ${Math.round(lag.max)}).` : ""}
        Trades from ${fmtDate(summary.window.first_transaction, false)} to ${fmtDate(summary.window.last_transaction)}; latest disclosure ${fmtDate(summary.window.last_disclosure)}.</li>
      <li><strong>Amounts are ranges.</strong> Members report a bracket (for example $1,001–$15,000), not an exact amount, so totals are ranges too.</li>
      ${t.unmatched_party ? `<li>${t.unmatched_party} trade${t.unmatched_party === 1 ? "" : "s"} couldn't be matched to a party (for example, members no longer in Congress) and ${t.unmatched_party === 1 ? "is" : "are"} shown as "Party unknown".</li>` : ""}
      <li>Updated daily from official House and Senate disclosures, collected by Bargo. Tracked tickers: ${AI_TICKERS.join(", ")}.</li>
    </ul>`;
}

// --- Member search (live) --------------------------------------------------

function searchMessage(text) {
  return `<p class="meta cg-message">${escapeHtml(text)}</p>`;
}

function renderResults(trades) {
  const byMember = new Map();
  for (const t of trades) {
    if (!byMember.has(t.member_slug)) byMember.set(t.member_slug, { info: t, ai: [], other: 0 });
    const entry = byMember.get(t.member_slug);
    if (TRACKED.has(t.ticker)) entry.ai.push(t);
    else entry.other += 1;
  }
  const blocks = [...byMember.values()].map(({ info, ai, other }) => {
    const party = partyBucket(partyFor(info, partyLookup));
    const heading = `${escapeHtml(info.member)} <span class="meta">${CHAMBER[info.chamber] || ""} · ${escapeHtml(info.state || "")} · ${party === "Unknown" ? "Party unknown" : party}</span>`;
    if (ai.length === 0) {
      return `<div class="cg-member"><div class="cg-member-name">${heading}</div>
        <p class="meta">No trades in the tracked AI stocks among the ${other} recent disclosures returned.</p></div>`;
    }
    const shown = ai.filter(fitsSize);
    const hidden = ai.length - shown.length;
    if (shown.length === 0) {
      return `<div class="cg-member"><div class="cg-member-name">${heading}</div>
        <p class="meta">${ai.length} AI-stock trade${ai.length === 1 ? "" : "s"} found, none of ${escapeHtml(sizeLabel())}. Choose "All sizes" to see ${ai.length === 1 ? "it" : "them"}.</p></div>`;
    }
    const rows = shown.map((t) => {
      const side = t.type === "purchase" ? "Buy" : t.type === "sale" ? "Sell" : "Exchange";
      const lag = Math.round((Date.parse(t.disclosure_date) - Date.parse(t.transaction_date)) / DAY_MS);
      return `<tr><td>${escapeHtml(t.ticker)}</td><td><i class="cg-key cg-key-${side.toLowerCase()}"></i>${side}</td><td>${escapeHtml(t.amount_range || "")}</td>
        <td>${fmtDate(t.transaction_date)}</td><td>${fmtDate(t.disclosure_date)}</td><td>${Number.isFinite(lag) ? lag : "–"}</td></tr>`;
    }).join("");
    return `<div class="cg-member"><div class="cg-member-name">${heading}</div>
      <div class="table-scroll"><table><thead><tr><th>Ticker</th><th>Type</th><th>Amount (range)</th><th>Traded</th><th>Disclosed</th><th>Days late</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${hidden ? `<p class="meta">${hidden} smaller AI-stock trade${hidden === 1 ? "" : "s"} hidden by the ${escapeHtml(sizeLabel())} filter.</p>` : ""}
      ${other ? `<p class="meta">Plus ${other} trade${other === 1 ? "" : "s"} in other stocks (not shown).</p>` : ""}</div>`;
  });
  return blocks.join("");
}

function showResults(resultsEl) {
  const { trades, callsLeft } = lastResults;
  resultsEl.innerHTML = renderResults(trades) +
    `<p class="meta">Live from Bargo: the ${SEARCH_LIMIT} most recent disclosed trades for matching members (free limit), last 3 months.${
      Number.isFinite(callsLeft) ? ` Free lookups left today: ${callsLeft}.` : ""}</p>`;
}

// --- Spelling help -----------------------------------------------------------
// ../data/members.json lists current members of Congress (public-domain
// congress-legislators data, written by the daily script). A query that matches
// nobody gets "Did you mean…?" suggestions BEFORE calling Bargo, so typos don't
// use up a free lookup.
let members = [];

function prepareMembers(list) {
  return list.map((m) => ({ ...m, tokens: normalizeName([m.name, m.first, m.nickname, m.last].filter(Boolean).join(" ")), lastKey: normalizeName(m.last).join(" ") }));
}

// Every word typed must start a word of the member's name ("cruz", "ted cru").
function findMembers(query) {
  const words = normalizeName(query);
  return words.length ? members.filter((m) => words.every((w) => m.tokens.some((t) => t.startsWith(w)))) : [];
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

// Closest last names to the last word typed (up to 1 typo per 3 letters).
function suggestMembers(query) {
  const words = normalizeName(query);
  const word = words[words.length - 1] || "";
  if (word.length < 3) return [];
  const limit = Math.max(1, Math.floor(word.length / 3));
  return members
    .map((m) => ({ m, d: Math.min(editDistance(word, m.lastKey), ...m.tokens.map((t) => editDistance(word, t))) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || (a.m.chamber === "senate" ? -1 : 1) - (b.m.chamber === "senate" ? -1 : 1) || a.m.name.localeCompare(b.m.name))
    .slice(0, 4)
    .map((x) => x.m);
}

const memberLabel = (m) => `${m.chamber === "senate" ? "Sen." : "Rep."} ${m.name} (${(m.party || "?").charAt(0)}-${m.state})`;

async function search(query, resultsEl, { skipCheck = false } = {}) {
  lastResults = null;
  const known = members.length ? findMembers(query) : [];
  if (members.length && !skipCheck && known.length === 0) {
    const suggestions = suggestMembers(query);
    if (suggestions.length) {
      resultsEl.innerHTML = `<div class="cg-suggest"><p class="meta">No current member of Congress matches "${escapeHtml(query)}". Did you mean:</p>
        <div class="cg-suggest-list">${suggestions.map((m) => `<button type="button" class="refresh" data-search="${escapeHtml(m.last)}">${escapeHtml(memberLabel(m))}</button>`).join("")}</div>
        <p class="meta"><button type="button" class="link-button" data-anyway="${escapeHtml(query)}">Search Bargo for "${escapeHtml(query)}" anyway</button> (for example, a former member)</p></div>`;
      return { members: 0, ai: 0, other: 0, suggestions: suggestions.length };
    }
  }
  resultsEl.innerHTML = searchMessage("Searching Bargo…");
  let response;
  try {
    response = await fetch(`${BARGO_API}/trades?member=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`, { signal: AbortSignal.timeout(15000) });
  } catch {
    resultsEl.innerHTML = searchMessage("Couldn't reach Bargo. Check your connection and try again.");
    return null;
  }
  const rowsLeft = Number(response.headers.get("x-ratelimit-rows-remaining"));
  const callsLeft = Number(response.headers.get("x-ratelimit-remaining"));
  if (response.status === 429 || (response.ok && callsLeft === 0)) {
    resultsEl.innerHTML = searchMessage("You've used today's free member lookups from Bargo. Try again tomorrow.");
    return null;
  }
  if (!response.ok) {
    resultsEl.innerHTML = searchMessage(`Bargo returned an error (HTTP ${response.status}). Try again later.`);
    return null;
  }
  const { trades = [] } = await response.json();
  if (trades.length === 0) {
    const names = known.slice(0, 3).map(memberLabel).join(", ") + (known.length > 3 ? `, and ${known.length - 3} more` : "");
    resultsEl.innerHTML = searchMessage(
      Number.isFinite(rowsLeft) && rowsLeft < SEARCH_LIMIT
        ? "You've used today's free member lookups from Bargo. Try again tomorrow."
        : known.length
          ? `Found ${names} in Congress, but Bargo has no disclosed trades for "${query}" in the last 3 months. Many members, especially senators, rarely trade.`
          : `No disclosed trades in the last 3 months for members matching "${query}". Check the spelling; a last name works best.`
    );
    return { members: 0, ai: 0, other: 0 };
  }
  lastResults = { trades, callsLeft };
  showResults(resultsEl);
  const ai = trades.filter((t) => TRACKED.has(t.ticker)).length;
  return { members: new Set(trades.map((t) => t.member_slug)).size, ai, other: trades.length - ai };
}

// --- Setup -------------------------------------------------------------------

export async function initCongressPanel() {
  const summaryEl = document.getElementById("cg-summary");
  const form = document.getElementById("cg-search");
  const input = document.getElementById("cg-query");
  const resultsEl = document.getElementById("cg-results");

  const [summaryResult, lookupResult, membersResult] = await Promise.allSettled([
    loadJson("../data/congress-ai-summary.json"),
    loadJson("../data/party-lookup.json"),
    loadJson("../data/members.json"),
  ]);
  if (lookupResult.status === "fulfilled") partyLookup = lookupResult.value;
  if (membersResult.status === "fulfilled" && Array.isArray(membersResult.value.members)) members = prepareMembers(membersResult.value.members);
  if (summaryResult.status === "fulfilled" && summaryResult.value.by_group?.length) {
    const summary = summaryResult.value;
    const filterEl = document.getElementById("cg-filter");
    const renderSummary = () => {
      const view = viewFor(summary);
      summaryEl.innerHTML = (view.totals.trades
        ? renderChart(view)
        : searchMessage(`No disclosed AI-stock trades of ${sizeLabel()} in this window.`)) + renderNotes(view) + renderTables(view);
    };
    renderSummary();
    // The filter needs the precomputed size counts, so it only appears when the summary has them.
    if (summary.amount_filters?.length) {
      filterEl.innerHTML = renderFilter();
      filterEl.hidden = false;
      filterEl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-min]");
        if (!button || Number(button.dataset.min) === minAmount) return;
        minAmount = Number(button.dataset.min);
        filterEl.innerHTML = renderFilter();
        renderSummary();
        if (lastResults) showResults(resultsEl);
        window.posthog?.capture("congress_amount_filter", { min_amount: minAmount, label: sizeLabel() });
      });
    }
  } else {
    summaryEl.innerHTML = searchMessage("The buys/sells summary isn't available yet. It updates once a day. Member search below works now.");
  }

  const run = async (query, options) => {
    const button = form.querySelector("button");
    button.disabled = true;
    const outcome = await search(query, resultsEl, options);
    button.disabled = false;
    // Shareable link: the search lives in the address bar (?member=...).
    const url = new URL(window.location.href);
    url.searchParams.set("member", query);
    history.replaceState(null, "", url);
    if (outcome) window.posthog?.capture("congress_search", { members_matched: outcome.members, ai_trades: outcome.ai, other_trades: outcome.other, suggestions_shown: outcome.suggestions || 0 });
  };

  // "Did you mean" buttons search that member's last name; "anyway" skips the check.
  resultsEl.addEventListener("click", (event) => {
    const pick = event.target.closest("button[data-search], button[data-anyway]");
    if (!pick) return;
    const anyway = pick.hasAttribute("data-anyway");
    input.value = anyway ? pick.dataset.anyway : pick.dataset.search;
    run(input.value, { skipCheck: anyway });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { query, error } = checkQuery(input.value);
    if (error) {
      resultsEl.innerHTML = searchMessage(error);
      return;
    }
    input.value = query;
    run(query);
  });

  // A shared link (?member=...) only runs a search if it passes the same check.
  const shared = new URL(window.location.href).searchParams.get("member");
  if (shared) {
    const { query } = checkQuery(shared);
    if (query) {
      input.value = query;
      run(query);
    }
  }
}
