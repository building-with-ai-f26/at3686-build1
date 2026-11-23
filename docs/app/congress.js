// "Capitol Hill AI trades" panel. Not part of the Burst Index.
//
// - The buys/sells chart reads ../data/congress-ai-summary.json: aggregates
//   built daily by scripts/update-congress-summary.mjs (no raw trade records,
//   per Bargo's terms).
// - Member search calls Bargo live from the visitor's own browser (no key, so
//   each visitor has Bargo's free per-day limit). Results are shown, never stored.
import { AI_TICKERS, BARGO_API, partyFor, partyBucket } from "./congress-common.js";
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
    const amount = range(g[`${side}_amount_low`], g[`${side}_amount_high`], g.open_ended > 0);
    const label = `${groupLabel(g)}: ${count} ${side}${count === 1 ? "" : "s"}, ${amount} disclosed`;
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
  return `<p class="cg-totals"><strong>${t.trades}</strong> disclosed trades: <strong>${t.buys}</strong> buys, <strong>${t.sells}</strong> sells${t.exchanges ? `, ${t.exchanges} exchange${t.exchanges === 1 ? "" : "s"}` : ""}.
      Disclosed amounts: buys ${usd(allBuys[0])}–${usd(allBuys[1])}, sells ${usd(allSells[0])}–${usd(allSells[1])}.</p>
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
    const rows = ai.map((t) => {
      const side = t.type === "purchase" ? "Buy" : t.type === "sale" ? "Sell" : "Exchange";
      const lag = Math.round((Date.parse(t.disclosure_date) - Date.parse(t.transaction_date)) / DAY_MS);
      return `<tr><td>${escapeHtml(t.ticker)}</td><td><i class="cg-key cg-key-${side.toLowerCase()}"></i>${side}</td><td>${escapeHtml(t.amount_range || "")}</td>
        <td>${fmtDate(t.transaction_date)}</td><td>${fmtDate(t.disclosure_date)}</td><td>${Number.isFinite(lag) ? lag : "–"}</td></tr>`;
    }).join("");
    return `<div class="cg-member"><div class="cg-member-name">${heading}</div>
      <div class="table-scroll"><table><thead><tr><th>Ticker</th><th>Type</th><th>Amount (range)</th><th>Traded</th><th>Disclosed</th><th>Days late</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${other ? `<p class="meta">Plus ${other} trade${other === 1 ? "" : "s"} in other stocks (not shown).</p>` : ""}</div>`;
  });
  return blocks.join("");
}

async function search(query, resultsEl) {
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
    resultsEl.innerHTML = searchMessage(
      Number.isFinite(rowsLeft) && rowsLeft < SEARCH_LIMIT
        ? "You've used today's free member lookups from Bargo. Try again tomorrow."
        : `No disclosed trades in the last 3 months for members matching "${query}".`
    );
    return { members: 0, ai: 0, other: 0 };
  }
  resultsEl.innerHTML = renderResults(trades) +
    `<p class="meta">Live from Bargo: the ${SEARCH_LIMIT} most recent disclosed trades for matching members (free limit), last 3 months.${
      Number.isFinite(callsLeft) ? ` Free lookups left today: ${callsLeft}.` : ""}</p>`;
  const ai = trades.filter((t) => TRACKED.has(t.ticker)).length;
  return { members: new Set(trades.map((t) => t.member_slug)).size, ai, other: trades.length - ai };
}

// --- Setup -------------------------------------------------------------------

export async function initCongressPanel() {
  const summaryEl = document.getElementById("cg-summary");
  const form = document.getElementById("cg-search");
  const input = document.getElementById("cg-query");
  const resultsEl = document.getElementById("cg-results");

  const [summaryResult, lookupResult] = await Promise.allSettled([
    loadJson("../data/congress-ai-summary.json"),
    loadJson("../data/party-lookup.json"),
  ]);
  if (lookupResult.status === "fulfilled") partyLookup = lookupResult.value;
  if (summaryResult.status === "fulfilled" && summaryResult.value.by_group?.length) {
    const summary = summaryResult.value;
    summaryEl.innerHTML = renderChart(summary) + renderNotes(summary) + renderTables(summary);
  } else {
    summaryEl.innerHTML = searchMessage("The buys/sells summary isn't available yet. It updates once a day. Member search below works now.");
  }

  const run = async (query) => {
    const button = form.querySelector("button");
    button.disabled = true;
    const outcome = await search(query, resultsEl);
    button.disabled = false;
    // Shareable link: the search lives in the address bar (?member=...).
    const url = new URL(window.location.href);
    url.searchParams.set("member", query);
    history.replaceState(null, "", url);
    if (outcome) window.posthog?.capture("congress_search", { members_matched: outcome.members, ai_trades: outcome.ai, other_trades: outcome.other });
  };

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
